import os
import random
import sqlite3
import time
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple

import tkinter as tk
from tkinter import ttk, messagebox
from PIL import Image, ImageTk

ALLOWED_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")

# PGA-style sub-scores (edit as needed)
RATING_FIELDS = ["erythema", "induration", "scaling", "overall_pga"]
RATING_MIN, RATING_MAX = 0, 4


# ----------------------------
# Roboflow folder discovery
# ----------------------------
def detect_subset_roots(dataset_root: str) -> Dict[str, str]:
    """
    Returns a map subset -> folder root to scan for images.
    Supports common Roboflow layouts:
      dataset_root/train/images
      dataset_root/valid/images
      dataset_root/test/images
    If images/ folders don't exist, it falls back to subset folder itself.
    """
    subset_map = {}
    for subset in ["train", "valid", "test"]:
        p1 = os.path.join(dataset_root, subset, "images")
        p2 = os.path.join(dataset_root, subset)
        if os.path.isdir(p1):
            subset_map[subset] = p1
        elif os.path.isdir(p2):
            subset_map[subset] = p2

    return subset_map


def list_images(root_dir: str) -> List[str]:
    paths = []
    for r, _, files in os.walk(root_dir):
        for f in files:
            if f.lower().endswith(ALLOWED_EXTS):
                paths.append(os.path.join(r, f))
    return sorted(paths)


def rel_image_id(dataset_root: str, image_path: str) -> str:
    """
    Use a stable ID for aggregation. Relative path is safer than basename
    (avoids collisions if different folders share a filename).
    """
    return os.path.relpath(image_path, dataset_root).replace("\\", "/")


# ----------------------------
# Database
# ----------------------------
def init_db(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                subset TEXT NOT NULL,
                image_id TEXT NOT NULL,
                image_path TEXT NOT NULL,
                erythema INTEGER,
                induration INTEGER,
                scaling INTEGER,
                overall_pga INTEGER,
                created_at INTEGER NOT NULL,
                UNIQUE(username, image_id)
            );
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ratings_image_id ON ratings(image_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ratings_username ON ratings(username);")
        conn.commit()
    finally:
        conn.close()


def has_user_rated(conn: sqlite3.Connection, username: str, image_id: str) -> bool:
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM ratings WHERE username=? AND image_id=? LIMIT 1;", (username, image_id))
    return cur.fetchone() is not None


def save_rating(
    conn: sqlite3.Connection,
    username: str,
    subset: str,
    image_id: str,
    image_path: str,
    ratings: Dict[str, int],
) -> None:
    now = int(time.time())
    cur = conn.cursor()
    cur.execute(
        """
        INSERT OR REPLACE INTO ratings
        (username, subset, image_id, image_path, erythema, induration, scaling, overall_pga, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        """,
        (
            username,
            subset,
            image_id,
            image_path,
            ratings.get("erythema"),
            ratings.get("induration"),
            ratings.get("scaling"),
            ratings.get("overall_pga"),
            now,
        ),
    )
    conn.commit()


# ----------------------------
# App
# ----------------------------
@dataclass
class SessionState:
    username: str
    subset_choice: str  # "all" | "train" | "valid" | "test"
    remaining: List[Tuple[str, str]]  # list of (subset, image_path)
    current: Optional[Tuple[str, str]] = None  # (subset, image_path)
    current_photo: Optional[ImageTk.PhotoImage] = None


class PGARaterApp(tk.Tk):
    def __init__(self, dataset_root: str, db_path: str):
        super().__init__()
        self.title("PGA Severity Rater (0–4)")
        self.geometry("1100x750")

        self.dataset_root = os.path.abspath(dataset_root)
        self.db_path = db_path

        init_db(self.db_path)
        self.conn = sqlite3.connect(self.db_path)

        self.subset_roots = detect_subset_roots(self.dataset_root)
        self.state: Optional[SessionState] = None

        # For "Jump to image"
        self.all_images: List[Tuple[str, str, str]] = []  # (subset, image_path, image_id)

        self._build_login_ui()

    def _clear_root(self):
        for w in self.winfo_children():
            w.destroy()

    def _build_login_ui(self):
        self._clear_root()

        frm = ttk.Frame(self, padding=20)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="Start Rating Session", font=("Arial", 18, "bold")).pack(pady=(0, 16))

        ttk.Label(frm, text="Username:", font=("Arial", 12)).pack(anchor="w")
        self.username_var = tk.StringVar()
        ttk.Entry(frm, textvariable=self.username_var, width=40).pack(anchor="w", pady=(4, 16))

        ttk.Label(frm, text="Dataset root:", font=("Arial", 12)).pack(anchor="w")
        ttk.Label(frm, text=self.dataset_root).pack(anchor="w", pady=(4, 16))

        # Subset dropdown
        ttk.Label(frm, text="Subset:", font=("Arial", 12)).pack(anchor="w")
        subset_options = ["all"] + sorted(self.subset_roots.keys())
        if subset_options == ["all"]:
            subset_options = ["all"]  # still allow scan-all fallback

        self.subset_var = tk.StringVar(value="all")
        ttk.Combobox(frm, textvariable=self.subset_var, values=subset_options, state="readonly", width=15).pack(
            anchor="w", pady=(4, 16)
        )

        ttk.Button(frm, text="Begin", command=self._start_session).pack(pady=10)

        hints = "Detected subsets: " + (
            ", ".join(sorted(self.subset_roots.keys())) if self.subset_roots else "(none; will scan all folders)"
        )
        ttk.Label(frm, text=hints).pack(anchor="w", pady=(12, 0))

    def _gather_images(self, subset_choice: str) -> List[Tuple[str, str]]:
        pairs: List[Tuple[str, str]] = []

        if subset_choice != "all":
            root = self.subset_roots.get(subset_choice)
            if root and os.path.isdir(root):
                for p in list_images(root):
                    pairs.append((subset_choice, p))
            return pairs

        # all: prefer detected subset roots; if none, scan dataset_root
        if self.subset_roots:
            for subset, root in self.subset_roots.items():
                for p in list_images(root):
                    pairs.append((subset, p))
        else:
            for p in list_images(self.dataset_root):
                pairs.append(("unknown", p))

        return pairs

    def _start_session(self):
        username = self.username_var.get().strip()
        if not username:
            messagebox.showerror("Missing username", "Please enter a username.")
            return

        subset_choice = self.subset_var.get().strip() or "all"
        all_pairs = self._gather_images(subset_choice)

        if not all_pairs:
            messagebox.showerror("No images found", f"No images found under:\n{self.dataset_root}")
            return

        # Build the full list (for Jump-to-image UI)
        self.all_images = [(subset, p, rel_image_id(self.dataset_root, p)) for subset, p in all_pairs]
        self.all_images.sort(key=lambda t: t[2])  # sort by image_id for nicer dropdown

        remaining: List[Tuple[str, str]] = []
        for subset, p in all_pairs:
            image_id = rel_image_id(self.dataset_root, p)
            if not has_user_rated(self.conn, username, image_id):
                remaining.append((subset, p))

        if not remaining:
            messagebox.showinfo("Done", "You have already rated all images (for this subset choice).")
            return

        random.shuffle(remaining)
        self.state = SessionState(username=username, subset_choice=subset_choice, remaining=remaining)

        self._build_rater_ui()
        self._load_next_image()

    def _build_rater_ui(self):
        self._clear_root()

        container = ttk.Frame(self, padding=10)
        container.pack(fill="both", expand=True)

        self.left = ttk.Frame(container)
        self.left.pack(side="left", fill="both", expand=True, padx=(0, 10))

        self.right = ttk.Frame(container)
        self.right.pack(side="right", fill="y")

        self.image_label = ttk.Label(self.left)
        self.image_label.pack(fill="both", expand=True)

        self.info_var = tk.StringVar(value="")
        ttk.Label(self.left, textvariable=self.info_var, font=("Arial", 11)).pack(pady=(8, 0), anchor="w")

        ttk.Label(self.right, text="Rate severity (0–4)", font=("Arial", 14, "bold")).pack(pady=(0, 10))

        self.scale_vars: Dict[str, tk.IntVar] = {}
        for field in RATING_FIELDS:
            block = ttk.Frame(self.right)
            block.pack(fill="x", pady=8)

            ttk.Label(block, text=field.replace("_", " ").title(), font=("Arial", 11)).pack(anchor="w")
            v = tk.IntVar(value=0)
            self.scale_vars[field] = v

            radios = ttk.Frame(block)
            radios.pack(anchor="w", pady=(4, 0))
            for i in range(RATING_MIN, RATING_MAX + 1):
                ttk.Radiobutton(radios, text=str(i), value=i, variable=v).pack(side="left", padx=4)

        btns = ttk.Frame(self.right)
        btns.pack(fill="x", pady=(20, 0))
        ttk.Button(btns, text="Submit", command=self._submit).pack(fill="x", pady=(0, 8))
        ttk.Button(btns, text="Skip (no save)", command=self._skip).pack(fill="x", pady=(0, 8))
        ttk.Button(btns, text="Quit", command=self.destroy).pack(fill="x")

        self.progress_var = tk.StringVar(value="")
        ttk.Label(self.right, textvariable=self.progress_var, font=("Arial", 10)).pack(pady=(16, 0))

        # ----------------------------
        # Jump to specific image (NEW)
        # ----------------------------
        ttk.Separator(self.right).pack(fill="x", pady=12)

        ttk.Label(self.right, text="Jump to image", font=("Arial", 11, "bold")).pack(anchor="w")

        self.jump_var = tk.StringVar()
        image_ids = [img_id for _, _, img_id in self.all_images]

        # For big datasets, combobox is still OK, but you can switch to an Entry if needed.
        ttk.Entry(self.right, textvariable=self.jump_var, width=45).pack(anchor="w", pady=(4, 6))


        ttk.Button(self.right, text="Load selected image", command=self._jump_to_image).pack(fill="x")

    def _resize_for_display(self, img: Image.Image, max_w: int, max_h: int) -> Image.Image:
        w, h = img.size
        scale = min(max_w / max(1, w), max_h / max(1, h))
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        return img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    def _load_image(self, subset: str, image_path: str, manual: bool = False):
        """Load a specific image into the UI (used by both random-next and jump-to)."""
        image_id = rel_image_id(self.dataset_root, image_path)

        for v in self.scale_vars.values():
            v.set(0)

        try:
            img = Image.open(image_path).convert("RGB")
        except Exception as e:
            messagebox.showerror("Image load error", f"Could not open:\n{image_path}\n\n{e}")
            return

        img_disp = self._resize_for_display(img, max_w=800, max_h=650)
        self.state.current_photo = ImageTk.PhotoImage(img_disp)
        self.image_label.configure(image=self.state.current_photo)

        tag = " (manual)" if manual else ""
        self.info_var.set(f"Subset: {subset}    Image ID: {image_id}{tag}")
        self.progress_var.set(f"Remaining: {len(self.state.remaining)}")

    def _load_next_image(self):
        assert self.state is not None

        if not self.state.remaining:
            messagebox.showinfo("Session complete", "No more images to rate. Thanks!")
            self._build_login_ui()
            return

        self.state.current = self.state.remaining.pop()
        subset, image_path = self.state.current
        self._load_image(subset, image_path, manual=False)

    # ----------------------------
    # Jump-to-image logic (NEW)
    # ----------------------------
    def _jump_to_image(self):
        assert self.state is not None

        target_id = self.jump_var.get().strip()
        if not target_id:
            messagebox.showerror("No image selected", "Please select an image ID from the dropdown.")
            return

        # Find the selected image in the known dataset list
        match = None
        for subset, path, img_id in self.all_images:
            if img_id == target_id:
                match = (subset, path, img_id)
                break

        if match is None:
            messagebox.showerror("Not found", f"Image '{target_id}' was not found in the current subset list.")
            return

        subset, path, img_id = match

        # If it's in the remaining queue, remove it so it won't be shown again randomly
        self.state.remaining = [(s, p) for (s, p) in self.state.remaining if p != path]

        # Set as current and load it
        self.state.current = (subset, path)
        self._load_image(subset, path, manual=True)

    def _collect_ratings(self) -> Dict[str, int]:
        ratings = {}
        for field, var in self.scale_vars.items():
            val = int(var.get())
            if not (RATING_MIN <= val <= RATING_MAX):
                raise ValueError(f"{field} must be between {RATING_MIN} and {RATING_MAX}")
            ratings[field] = val
        return ratings

    def _submit(self):
        assert self.state is not None and self.state.current is not None
        subset, image_path = self.state.current
        image_id = rel_image_id(self.dataset_root, image_path)

        try:
            ratings = self._collect_ratings()
        except Exception as e:
            messagebox.showerror("Invalid rating", str(e))
            return

        save_rating(self.conn, self.state.username, subset, image_id, image_path, ratings)
        self._load_next_image()

    def _skip(self):
        self._load_next_image()

    def destroy(self):
        try:
            self.conn.close()
        except Exception:
            pass
        super().destroy()


def main():
    # Set this to the folder created by unzip (often current directory ".")
    dataset_root = os.path.abspath(".")

    db_path = "pga_ratings.sqlite"
    app = PGARaterApp(dataset_root=dataset_root, db_path=db_path)
    app.mainloop()


if __name__ == "__main__":
    main()



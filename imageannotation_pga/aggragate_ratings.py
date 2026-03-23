import sqlite3
import math

DB_PATH = "pga_ratings.sqlite"
FIELDS = ["erythema", "induration", "scaling", "overall_pga"]

def mean_std(values):
    if not values:
        return float("nan"), float("nan")
    m = sum(values) / len(values)
    if len(values) < 2:
        return m, 0.0
    var = sum((x - m) ** 2 for x in values) / (len(values) - 1)
    return m, math.sqrt(var)

def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("SELECT DISTINCT image_id FROM ratings;")
    image_ids = [r[0] for r in cur.fetchall()]

    for image_id in sorted(image_ids):
        cur.execute(
            f"SELECT {', '.join(FIELDS)} FROM ratings WHERE image_id=?;",
            (image_id,),
        )
        rows = cur.fetchall()

        print(f"\nImage: {image_id}  (n_ratings={len(rows)})")
        for i, f in enumerate(FIELDS):
            vals = [float(r[i]) for r in rows if r[i] is not None]
            m, s = mean_std(vals)
            print(f"  {f:12s} mean={m:.3f}  std={s:.3f}  n={len(vals)}")

    conn.close()

if __name__ == "__main__":
    main()


import io
import os
import uuid
import numpy as np
from PIL import Image

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import firebase_admin
from firebase_admin import credentials, firestore, storage

from segmentation.dummy_model import DummyThresholdModel


cred = credentials.ApplicationDefault()
firebase_admin.initialize_app(cred, {
    "storageBucket": os.environ["FIREBASE_STORAGE_BUCKET"]
})

db = firestore.client()
bucket = storage.bucket()

# -----------------------
# Load model ONCE
# -----------------------
MODEL = DummyThresholdModel()

app = FastAPI()

class SegmentRequest(BaseModel):
    uid: str
    photoId: str

def download_image(url: str) -> np.ndarray:
   
    import requests
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content)).convert("RGB")
    return np.array(img, dtype=np.uint8)

def mask_to_png_rgba(mask01: np.ndarray) -> bytes:
    """
    Create a transparent PNG mask overlay:
    - lesion pixels colored red with alpha
    - background transparent
    """
    h, w = mask01.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = 255  # red
    rgba[..., 3] = (mask01.astype(np.uint8) * 140)  # alpha
    out = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()

@app.post("/segment")
def segment(req: SegmentRequest):
    photo_ref = db.collection("users").document(req.uid).collection("photos").document(req.photoId)
    snap = photo_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Photo doc not found")

    data = snap.to_dict()
    original_url = data.get("originalUrl") or data.get("url") or data.get("imageUrl")
    if not original_url:
        raise HTTPException(status_code=400, detail="Photo doc missing originalUrl/url/imageUrl")

    # Mark running
    photo_ref.set({
        "segmentation": {
            "status": "running",
            "updatedAt": firestore.SERVER_TIMESTAMP
        }
    }, merge=True)

    try:
        rgb = download_image(original_url)
        mask01 = MODEL.predict_mask(rgb)  # HxW (0/1)

        png_bytes = mask_to_png_rgba(mask01)

        mask_path = f"users/{req.uid}/photos/{req.photoId}/mask.png"
        blob = bucket.blob(mask_path)
        blob.upload_from_string(png_bytes, content_type="image/png")

        mask_url = blob.generate_signed_url(expiration=60 * 60 * 24 * 7)  # 7 days


        photo_ref.set({
            "segmentation": {
                "status": "done",
                "maskUrl": mask_url,
                "updatedAt": firestore.SERVER_TIMESTAMP
            }
        }, merge=True)

        return {"ok": True, "maskUrl": mask_url, "maskPath": mask_path}

    except Exception as e:
        photo_ref.set({
            "segmentation": {
                "status": "error",
                "error": str(e),
                "updatedAt": firestore.SERVER_TIMESTAMP
            }
        }, merge=True)
        raise HTTPException(status_code=500, detail=str(e))

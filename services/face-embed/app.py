"""
Face detection + embedding microservice for Dump. Deploy on a Vultr instance (CPU works; GPU is faster).

POST /embed  (multipart field "image")
  -> {"faces": [{"box": [x1,y1,x2,y2] (0..1), "embedding": [512 floats, L2-normalized], "score": float}]}

Images are processed in memory and never written to disk.
"""
import io

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from insightface.app import FaceAnalysis
from PIL import Image, ImageOps

app = FastAPI(title="dump-face-embed")
fa = FaceAnalysis(name="buffalo_l", providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
fa.prepare(ctx_id=0, det_size=(640, 640))

MIN_SCORE = 0.5


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/embed")
async def embed(image: UploadFile = File(...)):
    raw = await image.read()
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    except Exception:
        raise HTTPException(status_code=415, detail="unreadable image")
    w, h = img.size
    bgr = np.asarray(img)[:, :, ::-1]
    faces = []
    for f in fa.get(bgr):
        if f.det_score < MIN_SCORE:
            continue
        x1, y1, x2, y2 = [float(v) for v in f.bbox]
        faces.append(
            {
                "box": [max(0.0, x1 / w), max(0.0, y1 / h), min(1.0, x2 / w), min(1.0, y2 / h)],
                "embedding": [float(v) for v in f.normed_embedding],
                "score": float(f.det_score),
            }
        )
    return {"faces": faces}

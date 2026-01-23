import numpy as np
from .model_base import SegmentationModel

class DummyThresholdModel(SegmentationModel):
    """
    Placeholder model: very rough "segmentation" using intensity threshold.
    Replace this class with your real model later.
    """
    def predict_mask(self, rgb_image: np.ndarray) -> np.ndarray:
        gray = rgb_image.mean(axis=2)
        # naive: mark "darker" pixels as lesion-ish
        mask = (gray < 120).astype(np.uint8)
        return mask
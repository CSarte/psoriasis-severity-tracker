from abc import ABC, abstractmethod
import numpy as np

class SegmentationModel(ABC):
    @abstractmethod
    def predict_mask(self, rgb_image: np.ndarray) -> np.ndarray:
        """
        rgb_image: HxWx3 uint8
        returns: HxW bool or 0/1 mask (lesion=1)
        """
        raise NotImplementedError

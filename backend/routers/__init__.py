from fastapi import APIRouter

from .admin import router as admin_router
from .upload import router as upload_router


router = APIRouter()
router.include_router(upload_router)
router.include_router(admin_router)

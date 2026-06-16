from fastapi import APIRouter

from .admin import router as admin_router
from .template_mode import router as template_mode_router
from .upload import router as upload_router


router = APIRouter()
router.include_router(upload_router)
router.include_router(template_mode_router)
router.include_router(admin_router)

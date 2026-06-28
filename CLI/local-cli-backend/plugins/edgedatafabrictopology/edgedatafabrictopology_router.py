from fastapi import APIRouter

api_router = APIRouter(prefix="/edgedatafabrictopology", tags=["Edge Data Fabric Topology"])


@api_router.get("/")
async def plugin_info():
    """Return plugin metadata for health checks and discovery."""
    return {
        "name": "Edge Data Fabric Topology",
        "version": "1.0.0",
        "description": "Topology view for edge data fabric sites, nodes, containers, and tables."
    }

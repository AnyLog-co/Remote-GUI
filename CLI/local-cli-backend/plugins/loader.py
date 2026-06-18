# Enhanced Plugin Loader with Folder Support
import os
import importlib
import json
from fastapi import APIRouter
from typing import Dict, List, Optional

# Import feature config loader
try:
    from feature_config_loader import is_plugin_enabled
except ImportError:
    # Fallback if feature_config_loader is not available
    def is_plugin_enabled(plugin_name: str) -> bool:
        return True

def get_plugin_order_config(plugins_dir: str) -> Optional[Dict]:
    """
    Reads plugin order config from plugin_order.json if it exists.
    Returns None if no order file exists.
    """
    order_file = os.path.join(plugins_dir, 'plugin_order.json')
    if os.path.exists(order_file):
        try:
            with open(order_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️  Warning: Could not read plugin_order.json: {e}")
    return None

def _order_entry_name(entry) -> Optional[str]:
    """Support legacy string entries and object entries with name/id/key."""
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        return entry.get("name") or entry.get("id") or entry.get("key")
    return None

def get_plugin_order(plugins_dir: str) -> Optional[List[str]]:
    """
    Reads plugin order from plugin_order.json if it exists.
    Returns None if no order file exists.
    """
    config = get_plugin_order_config(plugins_dir)
    if not config:
        return None

    order = config.get('plugin_order', [])
    if isinstance(order, list):
        return [
            plugin_name
            for plugin_name in (_order_entry_name(entry) for entry in order)
            if plugin_name
        ]
    return None

def get_plugin_label_overrides(plugins_dir: str) -> Dict[str, str]:
    """Return plugin label overrides from plugin_order.json object entries."""
    config = get_plugin_order_config(plugins_dir) or {}
    overrides = {}

    for section in ("plugin_order", "sidebar_order"):
        entries = config.get(section, [])
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            plugin_name = _order_entry_name(entry)
            label = entry.get("label") or entry.get("name_override") or entry.get("title")
            if plugin_name and label:
                overrides[plugin_name] = label

    sidebar_sections = config.get("sidebar_sections", {})
    if isinstance(sidebar_sections, dict):
        for entries in sidebar_sections.values():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                plugin_name = _order_entry_name(entry)
                label = entry.get("label") or entry.get("name_override") or entry.get("title")
                if plugin_name and label:
                    overrides[plugin_name] = label

    return overrides

def load_plugins(app):
    """
    Enhanced plugin loader that:
    1. Scans the plugins directory for folders
    2. Looks for <plugin_name>_router.py files in each folder
    3. Loads the api_router from those files
    4. Adds those routers to the main FastAPI app
    5. Optionally respects plugin order from plugin_order.json
    """
    plugins_dir = os.path.dirname(os.path.abspath(__file__))
    loaded_plugins = []
    
    print("🔌 Loading plugins...")
    
    # Get all plugin folders
    plugin_folders = {}
    for item in os.listdir(plugins_dir):
        item_path = os.path.join(plugins_dir, item)
        
        # Skip if not a directory or starts with underscore
        if not os.path.isdir(item_path) or item.startswith('_'):
            continue
            
        plugin_name = item
        router_file = f"{plugin_name}_router.py"
        router_path = os.path.join(item_path, router_file)
        
        # Only add if router file exists
        if os.path.exists(router_path):
            plugin_folders[plugin_name] = item_path
    
    # Get plugin order from config if available
    plugin_order = get_plugin_order(plugins_dir)
    
    # Sort plugins according to order config, or alphabetically if no config
    if plugin_order:
        print(f"📋 Found plugin_order.json with order: {plugin_order}")
        # Create ordered list: plugins in config order first, then any remaining plugins
        ordered_plugins = []
        remaining_plugins = set(plugin_folders.keys())
        
        for plugin_name in plugin_order:
            if plugin_name in plugin_folders:
                ordered_plugins.append(plugin_name)
                remaining_plugins.discard(plugin_name)
            else:
                print(f"⚠️  Warning: Plugin '{plugin_name}' in plugin_order.json not found, skipping")
        
        # Add any plugins not in the order config (alphabetically sorted)
        if remaining_plugins:
            print(f"📋 Adding plugins not in config (alphabetically): {sorted(remaining_plugins)}")
        ordered_plugins.extend(sorted(remaining_plugins))
        plugin_names = ordered_plugins
        print(f"📋 Final plugin loading order: {plugin_names}")
    else:
        # Default: alphabetical order
        plugin_names = sorted(plugin_folders.keys())
        print(f"📋 No plugin_order.json found, using alphabetical order: {plugin_names}")
    
    # Load plugins in the determined order
    for plugin_name in plugin_names:
        # Check if plugin is enabled in feature config
        if not is_plugin_enabled(plugin_name):
            print(f"⏭️  Skipping disabled plugin: {plugin_name}")
            continue
        
        item_path = plugin_folders[plugin_name]
        router_file = f"{plugin_name}_router.py"
        router_path = os.path.join(item_path, router_file)
        
        try:
            # Import the plugin router module
            module_name = f'plugins.{plugin_name}.{plugin_name}_router'
            module = importlib.import_module(module_name)
            
            # Check if it has an api_router
            if hasattr(module, 'api_router'):
                router = module.api_router
                if isinstance(router, APIRouter):
                    # Add the router to the main app
                    app.include_router(router)
                    loaded_plugins.append(plugin_name)
                    print(f"✅ Loaded plugin: {plugin_name}")
                else:
                    print(f"❌ {plugin_name}: api_router is not an APIRouter")
            else:
                print(f"❌ {plugin_name}: No api_router found in {router_file}")
                
        except Exception as e:
            print(f"❌ Failed to load {plugin_name}: {e}")
    
    print(f"🔌 Plugin loading complete! Loaded: {loaded_plugins}")
    return loaded_plugins

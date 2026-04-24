from pydantic import BaseModel, ConfigDict, create_model, ValidationError
from .base_policy import BasePolicy
from typing import Dict, Any, List
from datetime import datetime, timedelta
import requests
import uuid
import sys
from .. import helpers

sys.path.append("..")


class GenericPolicy(BasePolicy):
    def __init__(self, template: Dict[str, Any], data: Dict[str, Any], node: str = None):
        self.template = template
        self.policy_type = template.get("policy_type", "unknown")
        self.node = node

        fields = template.get("fields", [])
        # Normalise fields — skip entries that have no "name" key
        fields = [f for f in fields if f.get("name")]

        template_field_names = {f["name"] for f in fields}
        self.custom_fields = {
            k: v for k, v in data.items() if k not in template_field_names
        }
        template_data = {
            k: v for k, v in data.items() if k in template_field_names
        }

        self.schema = self._build_pydantic_model(fields)

        try:
            self.data_model = self.schema(**template_data)
        except ValidationError as e:
            raise ValueError(f"Validation error: {e}")

        self.generated_fields = self._generate_backend_fields(fields)

    def _build_pydantic_model(self, fields: List[Dict[str, Any]]) -> BaseModel:
        model_fields = {}
        for field in fields:
            if field.get("type") == "generated":
                continue  # exclude backend-generated fields

            name = field["name"]
            ftype = self._map_type(field.get("type", "string"))
            required = field.get("required", False)

            default = ... if required else None
            model_fields[name] = (ftype, default)

        return create_model(f"{self.policy_type.capitalize()}PolicyModel", **model_fields)

    def _map_type(self, template_type: str):
        mapping = {
            "string": str,
            "integer": int,
            "float": float,
            "boolean": bool,
            "select": str,  # still a string but constrained by options (optional to enforce)
            "object": Dict[str, Any],
            "array": List[str],  # NEW
            "permission": List[Any],  # NEW
            "security_group": List[Any],
            "table": List[Any]
        }
        return mapping.get(template_type, str)

    def _generate_field_value(self, source: str):
        try:
            if source == "uuid":
                return str(uuid.uuid4())
            elif source == "hash_id":
                return uuid.uuid4().hex
            elif source == "date":
                return datetime.utcnow().isoformat() + "Z"
            elif source == "timestamp" or source == "expiration":
                return (datetime.utcnow() + timedelta(days=30)).isoformat() + "Z"
            elif source == "ipinfo.loc":
                res = requests.get("https://ipinfo.io/json")
                if res.ok:
                    return res.json().get("loc", "unknown")
                return "unknown"
            elif source == "ipinfo.city":
                res = requests.get("https://ipinfo.io/json")
                if res.ok:
                    return res.json().get("city", "unknown") 
                return "unknown"
            elif source == "ipinfo.country":
                res = requests.get("https://ipinfo.io/json")
                if res.ok:
                    return res.json().get("country", "unknown") 
                return "unknown"
            elif source == "private_key":
                # resp = helpers.make_request(self.node, "POST", "set authentication off")
                # resp = helpers.make_request(self.node, "POST", "set local password = password123")
                # resp = helpers.make_request(self.node, "POST", "set authentication on")
                resp = helpers.make_request(self.node, "POST", "get authentication")
                print( f"[Generator] Response from this: {resp}")
                return resp  # Placeholder for private key
        except Exception as e:
            print(f"[Generator] Failed to generate {source}: {e}")
            return f"generated:{source}"

    def _generate_backend_fields(self, fields: List[Dict[str, Any]]) -> Dict[str, Any]:
        output = {}
        for field in fields:
            if field.get("type") != "generated":
                continue

            name = field["name"]
            source = field.get("source", name)  # fallback to name as source
            output[name] = self._generate_field_value(source)

        return output

    def validate(self) -> bool:
        # You could add semantic validation here (e.g. port ranges)
        return True

    @staticmethod
    def _quote_strings_deep(value: Any) -> Any:
        """Wrap bare strings in quotes and recurse into dicts/lists."""
        if isinstance(value, str):
            return f'"{value}"'
        if isinstance(value, dict):
            return {k: GenericPolicy._quote_strings_deep(v) for k, v in value.items()}
        if isinstance(value, list):
            return [GenericPolicy._quote_strings_deep(v) for v in value]
        return value

    def to_dict(self) -> Dict[str, Any]:
        result = self.data_model.model_dump()
        result.update(self.generated_fields)

        # Build replacement result
        final_result = {}

        if "post_process" in self.template:
            final_result["__post_process__"] = self.template["post_process"]

        fields = [f for f in self.template.get("fields", []) if f.get("name")]
        for field in fields:
            name = field["name"]

            # If field has modifiers
            if "modifiers" in field:
                val = result.get(name)
                val_str = str(val).lower() if isinstance(val, bool) else str(val)

                modifier = field["modifiers"].get(val_str)
                if modifier:
                    final_result.update(modifier)
            else:
                # Normal field — skip None and empty values entirely
                if name not in result:
                    continue
                value = result[name]
                if value is None:
                    continue
                if isinstance(value, str):
                    if value == '':
                        continue
                    final_result[name] = f'"{value}"'
                elif isinstance(value, dict):
                    if not value:
                        continue
                    final_result[name] = self._quote_strings_deep(value)
                elif isinstance(value, list):
                    if not value:
                        continue
                    final_result[name] = value
                else:
                    final_result[name] = value

        # Append user-defined custom fields (not in the template)
        for key, value in self.custom_fields.items():
            if value is None or value == '' or (isinstance(value, (dict, list)) and not value):
                continue
            final_result[key] = self._quote_strings_deep(value)

        return {self.policy_type: final_result}

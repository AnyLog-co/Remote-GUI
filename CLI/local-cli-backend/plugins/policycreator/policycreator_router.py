from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel
from typing import Dict, List
import json
import os

from security.models.generic_policy import GenericPolicy
from security import helpers
from security import permissions
from security import assignment_manager

api_router = APIRouter(prefix="/policycreator", tags=["Policy Creator"])

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(_PLUGIN_DIR, "templates")


# --------------- Request models --------------- #

class SubmitPolicyRequest(BaseModel):
    node: str
    policy_file: str
    policy: Dict
    member_pubkey: str = None
    signing_member_name: str = None


class SubmitCustomPolicyRequest(BaseModel):
    node: str
    policy_type: str
    policy: Dict


class RegenerateAssignmentsRequest(BaseModel):
    node: str
    security_group: str = None


class AssignmentSummaryRequest(BaseModel):
    node: str


class AvailableSigningMembersRequest(BaseModel):
    node: str
    pubkey: str


# --------------- Endpoints --------------- #

@api_router.get("/")
def root():
    return {
        "name": "Policy Creator Plugin",
        "version": "1.0.0",
        "description": "All-round helper for creating various AnyLog policy types",
        "endpoints": [
            "/policy-types - List available policy templates",
            "/policy-template/{policy_file} - Get a specific template",
            "/submit - Submit a new policy",
            "/type-options - Get dynamic options for template field types",
            "/custom-types - Get available custom types",
            "/permissions/{node} - Get on-chain permissions",
            "/available-signing-members - Get members that can sign policies",
            "/assignment-summary - Summary of assignment policies",
            "/regenerate-assignments - Regenerate assignment policies",
        ],
    }


@api_router.get("/policy-types")
def list_policy_types():
    policy_list = []
    for filename in os.listdir(TEMPLATE_DIR):
        if filename.endswith("_policy.json"):
            try:
                with open(os.path.join(TEMPLATE_DIR, filename), "r") as f:
                    template = json.load(f)
                    policy_list.append({
                        "type": template.get("policy_file"),
                        "name": template.get("name", template.get("policy_file")),
                    })
            except Exception:
                continue
    return {"types": policy_list}


@api_router.get("/policy-template/{policy_file}")
def get_policy_template(policy_file: str):
    file_path = os.path.join(TEMPLATE_DIR, f"{policy_file}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Policy template not found")
    with open(file_path, "r") as f:
        return json.load(f)


def _policy_factory(policy_file: str, policy_data: Dict, node: str = None):
    template_path = os.path.join(TEMPLATE_DIR, f"{policy_file}.json")
    if not os.path.exists(template_path):
        raise HTTPException(status_code=404, detail="Template not found")
    with open(template_path, "r") as f:
        template = json.load(f)
    try:
        return GenericPolicy(template, policy_data, node)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@api_router.post("/submit")
def submit_policy(request: SubmitPolicyRequest):
    policy_obj = _policy_factory(request.policy_file, request.policy, request.node)

    if not policy_obj.validate():
        raise HTTPException(status_code=422, detail="Policy validation failed")

    final_json = policy_obj.to_dict()

    signing_member_name = None

    if request.policy_file == "member_policy":
        print("Member policy detected - new member will sign themselves after key creation")
    else:
        if request.signing_member_name:
            signing_member_name = request.signing_member_name
        else:
            if request.member_pubkey:
                try:
                    member_policy = permissions.get_member_policy(
                        request.node, f'"{request.member_pubkey}"'
                    )
                    if member_policy and len(member_policy) > 0:
                        signing_member_name = (
                            member_policy[0].get("member", {}).get("name")
                        )
                except Exception as e:
                    print(f"Warning: Could not get member policy for {request.member_pubkey}: {e}")
            if not signing_member_name:
                signing_member_name = "admin"

    if signing_member_name:
        for _policy_type, policy_data in final_json.items():
            if isinstance(policy_data, dict):
                policy_data["__signing_member_name__"] = signing_member_name

    try:
        resp = helpers.make_policy(request.node, final_json)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create policy on node: {str(e)}",
        )
    return resp


@api_router.post("/submit-custom")
def submit_custom_policy(request: SubmitCustomPolicyRequest):
    """Submit a fully custom policy with no template — just a type name and arbitrary fields."""
    if not request.policy_type or not request.policy_type.strip():
        raise HTTPException(status_code=422, detail="policy_type is required")

    policy_type = request.policy_type.strip()

    def _quote_deep(value):
        if isinstance(value, str):
            return f'"{value}"'
        if isinstance(value, dict):
            return {k: _quote_deep(v) for k, v in value.items()}
        if isinstance(value, list):
            return [_quote_deep(v) for v in value]
        return value

    policy_data = {}
    for key, value in request.policy.items():
        if value is None or value == '' or (isinstance(value, (dict, list)) and not value):
            continue
        policy_data[key] = _quote_deep(value)

    final_json = {policy_type: policy_data}

    try:
        resp = helpers.make_policy(request.node, final_json)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create policy on node: {str(e)}",
        )
    return resp


@api_router.get("/custom-types")
def get_custom_types():
    try:
        types = ["node", "table", "security_group"]
        return {"custom_types": types}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get custom types: {str(e)}")


@api_router.post("/type-options")
def get_type_options(node: str = Body(...), type: str = Body(...)):
    try:
        if type == "node":
            return {"options": helpers.get_node_options(node)}
        elif type == "table":
            return {"options": helpers.get_table_options(node)}
        elif type == "security_group":
            resp = helpers.get_security_groups(node)
            return {"options": resp}
        else:
            return {"options": []}
    except Exception as e:
        print(f"Failed to get options for type '{type}': {str(e)}")
        return {"options": []}


@api_router.get("/permissions/{node}")
def get_permissions(node: str):
    return helpers.get_permissions(node)


@api_router.post("/available-signing-members")
def get_available_signing_members(request: AvailableSigningMembersRequest):
    try:
        command = "blockchain get member"
        response = helpers.make_request(request.node, "GET", command)

        if not response or not isinstance(response, list):
            return {"members": []}

        available_members = []
        for member_data in response:
            if isinstance(member_data, dict) and "member" in member_data:
                member = member_data["member"]
                member_name = member.get("name")
                member_type = member.get("type", "user")
                public_key = member.get("public_key")
                if member_name and public_key:
                    available_members.append({
                        "name": member_name,
                        "type": member_type,
                        "description": f"{member_type.title()} member",
                        "public_key": public_key,
                    })
        return {"members": available_members}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get available signing members: {str(e)}",
        )


# --------------- Assignment management --------------- #

@api_router.post("/regenerate-assignments")
def regenerate_assignments(request: RegenerateAssignmentsRequest):
    try:
        if request.security_group:
            assignment_manager.regenerate_assignments_for_security_group(
                request.node, request.security_group
            )
            return {
                "success": True,
                "message": f"Regenerated assignments for security group: {request.security_group}",
            }
        else:
            assignment_manager.regenerate_all_assignments(request.node)
            return {"success": True, "message": "Regenerated all assignment policies"}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to regenerate assignments: {str(e)}",
        )


@api_router.post("/assignment-summary")
def get_assignment_summary(request: AssignmentSummaryRequest):
    try:
        return assignment_manager.get_assignment_summary(request.node)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get assignment summary: {str(e)}",
        )


@api_router.get("/debug-members/{node}")
def debug_members(node: str):
    try:
        command = "blockchain get member"
        response = helpers.make_request(node, "GET", command)
        return {
            "node": node,
            "command": command,
            "response": response,
            "count": len(response) if response else 0,
        }
    except Exception as e:
        return {"node": node, "error": str(e)}

# UNS Plugin - Unified Namespace
# Provides filesystem-like interface for blockchain metadata

import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from plugins.utils import make_request
from parsers import parse_response
from plugins.utils import get_data_nodes_for_table

# Create the API router
api_router = APIRouter(prefix="/uns", tags=["UNS"])

# Request models
class BlockchainQueryRequest(BaseModel):
    conn: str
    item_id: Optional[str] = None
    include_children: bool = False

class GetRootRequest(BaseModel):
    conn: str
    query: Optional[str] = "blockchain get root policies"  # Default to blockchain get * if not provided

class QueryTableRequest(BaseModel):
    conn: str
    dbms: str
    table: str
    time_value: float = 5.0  # Time range value
    time_unit: str = "minute"  # Time unit: minute, hour, day, etc.
    where: Optional[str] = None  # Optional policy where clause (e.g. "rig_id='RIG-TX-001'")
    column: Optional[str] = None  # When set, only fetch insert_timestamp and this column

class QueryCustomRequest(BaseModel):
    conn: str
    dbms: str
    sql_query: str  # Custom SQL query

class CheckTableRequest(BaseModel):
    conn: str
    dbms: str
    table: str

class CheckChildrenRequest(BaseModel):
    conn: str
    item_id: str

class ColumnDetailsRequest(BaseModel):
    conn: str
    dbms: str
    table: str
    column: str
    where: Optional[str] = None
    time_value: float = 5.0
    time_unit: str = "minute"
    column_type: str = "string"  # "numerical" or "string"

# API endpoints
@api_router.get("/")
async def uns_info():
    """Get UNS plugin information"""
    return {
        "name": "Unified Namespace Plugin",
        "version": "1.0.0",
        "description": "Filesystem-like interface for blockchain metadata"
    }

@api_router.post("/get-root")
async def get_root(request: GetRootRequest):
    """Get root items using configurable query"""
    try:
        command = request.query or "blockchain get *"
        print(f"UNS: Executing command: {command}")
        print(f"UNS: Connection: {request.conn}")
        print(f"UNS: Query: {request.query}")
        response = make_request(request.conn, "GET", command)
        parsed = parse_response(response)
        
        # Extract data from response
        if isinstance(parsed, dict) and "data" in parsed:
            data = parsed["data"]
        elif isinstance(parsed, list):
            data = parsed
        else:
            data = parsed
        
        # Ensure data is a list
        if not isinstance(data, list):
            data = [data] if data else []
        
        # Log first item structure for debugging
        if data and len(data) > 0:
            print(f"UNS: First root item structure: {data[0]}")
        
        return {
            "success": True,
            "data": data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get root items: {str(e)}")

@api_router.post("/get-item")
async def get_item(request: BlockchainQueryRequest):
    """Get a specific item by ID"""
    try:
        if not request.item_id:
            raise HTTPException(status_code=400, detail="item_id is required")
        
        command = f'blockchain get * where [id] = "{request.item_id}"'
        print(f"UNS: Executing command: {command}")
        print(f"UNS: Connection: {request.conn}")
        print(f"UNS: Item ID: {request.item_id}")
        response = make_request(request.conn, "GET", command)
        parsed = parse_response(response)
        
        # Extract data from response
        if isinstance(parsed, dict) and "data" in parsed:
            data = parsed["data"]
        elif isinstance(parsed, list):
            data = parsed
        else:
            data = parsed
        
        return {
            "success": True,
            "data": data if isinstance(data, list) else [data] if data else []
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get item: {str(e)}")

@api_router.post("/get-children")
async def get_children(request: BlockchainQueryRequest):
    """Get children of a specific item"""
    try:
        if not request.item_id:
            raise HTTPException(status_code=400, detail="item_id is required")
        
        command = f'blockchain get * where [id] = "{request.item_id}" bring.children'
        print(f"UNS: Executing command: {command}")
        print(f"UNS: Connection: {request.conn}")
        print(f"UNS: Item ID: {request.item_id}")
        response = make_request(request.conn, "GET", command)
        parsed = parse_response(response)

        
        # Extract data from response
        if isinstance(parsed, dict) and "data" in parsed:
            data = parsed["data"]
        elif isinstance(parsed, list):
            data = parsed
        else:
            data = parsed
        
        return {
            "success": True,
            "data": data if isinstance(data, list) else [data] if data else []
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get children: {str(e)}")

@api_router.post("/query-table")
async def query_table(request: QueryTableRequest):
    """Query table data for the last N hours"""
    try:
        if not request.dbms or not request.table:
            raise HTTPException(status_code=400, detail="dbms and table are required")
        
        # Build SQL query: when column in policy, only fetch insert_timestamp + that column; else SELECT *
        time_value = request.time_value or 5.0
        time_unit = request.time_unit or "minute"
        
        # Convert to int if it's a whole number, otherwise keep as float
        time_value_str = str(int(time_value)) if time_value == int(time_value) else str(time_value)
        
        if request.column and request.column.strip():
            col = _quote_identifier(request.column.strip())
            select_clause = f"insert_timestamp, {col}"
        else:
            select_clause = "*"
        
        # Base time filter
        sql_query = f'SELECT {select_clause} FROM {request.table} WHERE period({time_unit}, {time_value_str}, NOW(), insert_timestamp)'
        if request.where and request.where.strip():
            sql_query += f" AND ({request.where.strip()})"
        # Use the exact format that works in the client dashboard
        command = f'run client () sql {request.dbms} format = table "{sql_query}"'
        
        print(f"UNS: Executing SQL command: {command}")
        print(f"UNS: Connection: {request.conn}")
        print(f"UNS: DBMS: {request.dbms}, Table: {request.table}, Time: {time_value} {time_unit}")
        print(f"UNS: Full command string: {repr(command)}")
        
        # Use GET method like the client dashboard does
        response = make_request(request.conn, "GET", command)   
        print("response", response)
        # print(f"UNS: Raw response type: {type(response)}")
        # print(f"UNS: Raw response length: {len(str(response)) if response else 0}")
        # print(f"UNS: Raw response preview (first 1000 chars): {str(response)[:1000] if response else 'None'}")
        
        parsed = parse_response(response)
        print("parsed", parsed)
        # print(f"UNS: Parsed response type: {type(parsed)}")
        # print(f"UNS: Parsed response keys: {parsed.keys() if isinstance(parsed, dict) else 'N/A'}")
        
        # Extract data from response
        if isinstance(parsed, dict) and "data" in parsed:
            data = parsed["data"]
            # print(f"UNS: Extracted data from parsed['data'], type: {type(data)}, length: {len(data) if isinstance(data, list) else 'N/A'}")
        elif isinstance(parsed, list):
            data = parsed
            # print(f"UNS: Parsed is list, length: {len(data)}")
        elif isinstance(parsed, dict) and "type" in parsed:
            # Check if it's an error response
            if parsed.get("type") == "error":
                return {
                    "success": False,
                    "error": parsed.get("data", "Unknown error occurred"),
                    "data": None
                }
            data = parsed.get("data", parsed)
            # print(f"UNS: Extracted from parsed dict, type: {type(data)}, length: {len(data) if isinstance(data, list) else 'N/A'}")
        else:
            data = parsed
            # print(f"UNS: Using parsed directly, type: {type(data)}")
        
        # Handle case where data might be a string (JSON string)
        if isinstance(data, str):
            try:
                import json
                data = json.loads(data)
            except (json.JSONDecodeError, ValueError):
                pass
        
        # Ensure data is a list
        if not isinstance(data, list):
            data = [data] if data else []
        
        # print(f"UNS: Data before filtering - type: {type(data)}, length: {len(data) if isinstance(data, list) else 'N/A'}")
        if isinstance(data, list) and len(data) > 0:
            print(len(data))
            print(f"UNS: First row sample: {data[0]}")
            print(f"UNS: Last row sample: {data[-1]}")
        
        # Filter out internal columns (row_id, tsd_name, tsd_id, timestamp) from each row
        # timestamp is excluded as insert_timestamp is used for the chart
        filtered_data = []
        columns_to_exclude = {'row_id', 'tsd_name', 'tsd_id', 'timestamp'}
        
        for row in data:
            if isinstance(row, dict):
                # Filter out the internal columns
                filtered_row = {k: v for k, v in row.items() if k not in columns_to_exclude}
                filtered_data.append(filtered_row)
            elif isinstance(row, list):
                # If it's a list (table format), we need to handle it differently
                # For now, keep it as is if it's not a dict
                filtered_data.append(row)
            else:
                filtered_data.append(row)
        
        # print(f"UNS: Filtered data length: {len(filtered_data)}")
        # print(f"UNS: Returning {len(filtered_data)} rows to frontend")
        
        return {
            "success": True,
            "data": filtered_data,
            "error": None
        }
    except Exception as e:
        error_msg = str(e)
        print(f"UNS: SQL query error: {error_msg}")
        return {
            "success": False,
            "error": error_msg,
            "data": None
        }

@api_router.post("/query-custom")
async def query_custom(request: QueryCustomRequest):
    """Execute a custom SQL query. On any error, returns success=False, data=[], error=message to avoid frontend crashes."""
    def _error_response(msg: str):
        return {"success": False, "error": msg, "data": []}

    try:
        if not request.dbms or not request.sql_query:
            return _error_response("dbms and sql_query are required")

        command = f'run client () sql {request.dbms} format = table "{request.sql_query}"'
        print(f"UNS: Executing custom SQL command: {command}")

        try:
            response = make_request(request.conn, "GET", command)
        except Exception as req_err:
            error_msg = str(req_err)
            print(f"UNS: Custom query request error: {error_msg}")
            return _error_response(error_msg)

        try:
            parsed = parse_response(response)
        except Exception as parse_err:
            error_msg = str(parse_err)
            print(f"UNS: Custom query parse error: {error_msg}")
            return _error_response(error_msg)

        if parsed is None:
            return _error_response("No response received")

        # Check for explicit error type
        if isinstance(parsed, dict) and parsed.get("type") == "error":
            return _error_response(parsed.get("data", "Unknown error occurred"))

        # Extract data from response
        data = None
        if isinstance(parsed, dict) and "data" in parsed:
            data = parsed["data"]
        elif isinstance(parsed, list):
            data = parsed
        elif isinstance(parsed, dict):
            data = parsed.get("data", parsed.get("Query"))
        else:
            data = parsed

        if data is None:
            data = []

        if isinstance(data, str):
            try:
                data = json.loads(data)
            except (json.JSONDecodeError, ValueError):
                return _error_response("Invalid response format")

        if not isinstance(data, list):
            data = [data] if data else []

        # Filter out internal columns
        filtered_data = []
        columns_to_exclude = {'row_id', 'tsd_name', 'tsd_id', 'timestamp'}
        for row in data:
            if isinstance(row, dict):
                filtered_row = {k: v for k, v in row.items() if k not in columns_to_exclude}
                filtered_data.append(filtered_row)
            elif isinstance(row, list):
                filtered_data.append(row)
            else:
                filtered_data.append(row)

        return {"success": True, "data": filtered_data, "error": None}
    except Exception as e:
        error_msg = str(e)
        print(f"UNS: Custom SQL query error: {error_msg}")
        return _error_response(error_msg)

def _quote_identifier(name: str) -> str:
    """Quote identifier for SQL (e.g. column names with spaces)."""
    if not name:
        return "''"
    return f'"{name}"' if " " in name or "-" in name or any(c in name for c in ".*") else name

def _extract_query_rows(response):
    """Extract rows from raw run_sql JSON response. Expects {Query: [...], Statistics: [...]} or JSON string."""
    if response is None:
        return []
    if isinstance(response, str):
        try:
            response = json.loads(response)
        except json.JSONDecodeError:
            return []
    if isinstance(response, dict) and response.get("type") == "error":
        return None
    if isinstance(response, list):
        return response
    if isinstance(response, dict):
        return response.get("Query") or response.get("data") or []
    return []

@api_router.post("/column-details")
async def column_details(request: ColumnDetailsRequest):
    """Get column details: numerical (min, max, avg) or string (latest value, last occurrence per value)."""
    try:
        if not request.dbms or not request.table or not request.column:
            raise HTTPException(status_code=400, detail="dbms, table and column are required")
        col = _quote_identifier(request.column)
        tv = request.time_value or 5.0
        tu = request.time_unit or "minute"
        tv_str = str(int(tv)) if tv == int(tv) else str(tv)
        where = f" AND ({request.where.strip()})" if request.where and request.where.strip() else ""
        where_group = f" WHERE {request.where.strip()}" if request.where and request.where.strip() else ""
        period = f"period({tu}, {tv_str}, NOW(), insert_timestamp)"

        def run_sql(sql):
            s = f'run client () sql {request.dbms} format = json "{sql}"'
            print("s is: ", s)
            return make_request(request.conn, "GET", s)

        if request.column_type == "numerical":
            rows = _extract_query_rows(run_sql(
                f"SELECT min({col}) as min, max({col}) as max, avg({col}) as avg FROM {request.table} WHERE {period}{where}"))
            row = rows[0] if rows and isinstance(rows[0], dict) else {}
            # Also fetch latest value for numerical summary
            latest_rows = _extract_query_rows(run_sql(
                f"SELECT insert_timestamp, {col} FROM {request.table}{where_group} ORDER BY insert_timestamp DESC LIMIT 1"))
            latest_row = latest_rows[0] if latest_rows and isinstance(latest_rows[0], dict) else {}
            latest_value = latest_row.get(request.column) or (list(latest_row.values())[0] if latest_row else None)
            return {"success": True, "column_type": "numerical",
                    "data": {"min": row.get("min"), "max": row.get("max"), "avg": row.get("avg"),
                             "latest_value": latest_value}, "error": None}

        # string: latest value + last occurrence per value
        latest_rows = _extract_query_rows(run_sql(
            f"SELECT insert_timestamp, {col} FROM {request.table}{where_group} ORDER BY insert_timestamp DESC LIMIT 1"))
        row0 = latest_rows[0] if latest_rows and isinstance(latest_rows[0], dict) else {}
        latest_value = row0.get(request.column) or (list(row0.values())[0] if row0 else None)

        group_rows = _extract_query_rows(run_sql(
            f"SELECT {col}, max(timestamp) FROM {request.table}{where_group} GROUP BY {col}"))
        last_occurrence = []
        for r in (group_rows or []):
            if not isinstance(r, dict):
                continue
            val = r.get(request.column)
            ts = r.get("max(timestamp)")
            if val is None:
                val = next((v for k, v in r.items() if k != "max(timestamp)"), None)
            last_occurrence.append({"value": val, "last_timestamp": ts})

        return {"success": True, "column_type": "string",
                "data": {"latest_value": latest_value, "last_occurrence_per_value": last_occurrence}, "error": None}
    except Exception as e:
        return {"success": False, "error": str(e), "data": None}

@api_router.post("/check-table")
async def check_table(request: CheckTableRequest):
    """Check if a table exists at the location using get data nodes (returns empty list if no table)."""
    try:
        if not request.dbms or not request.table:
            raise HTTPException(status_code=400, detail="dbms and table are required")
        
        # Use get data nodes: returns empty list if no table at this location (no error)
        nodes = get_data_nodes_for_table(request.conn, request.dbms, request.table)
        has_data = len(nodes) > 0
        
        if not has_data:
            print(f"UNS: No data nodes for {request.dbms}.{request.table} - treating as no table")
        
        return {
            "success": True,
            "has_data": has_data,
            "column_count": len(nodes),  # number of nodes matching dbms/table
            "error": None
        }
    except Exception as e:
        error_msg = str(e)
        print(f"UNS: Check table error: {error_msg}")
        return {
            "success": False,
            "has_data": False,
            "column_count": 0,
            "error": error_msg
        }

@api_router.post("/check-children")
async def check_children(request: CheckChildrenRequest):
    """Check if an item has children by attempting to fetch them"""
    try:
        if not request.item_id:
            raise HTTPException(status_code=400, detail="item_id is required")
        
        command = f'blockchain get * where [id] = "{request.item_id}" bring.children'
        print(f"UNS: Checking children for item: {request.item_id}")
        
        response = make_request(request.conn, "GET", command)
        
        # Check if make_request returned an error response
        if isinstance(response, dict) and response.get("type") == "error":
            error_msg = response.get("data", "Unknown error")
            print(f"UNS: Error checking children for {request.item_id}: {error_msg}")
            return {
                "success": False,
                "has_children": False,
                "error": None
            }
        
        parsed = parse_response(response)
        
        # Check if parse_response returned an error
        if isinstance(parsed, dict) and parsed.get("type") == "error":
            error_msg = parsed.get("data", "Unknown error")
            print(f"UNS: Error parsing children response for {request.item_id}: {error_msg}")
            return {
                "success": False,
                "has_children": False,
                "error": None
            }
        
        # Extract data from response
        if isinstance(parsed, dict) and "data" in parsed:
            data = parsed["data"]
        elif isinstance(parsed, list):
            data = parsed
        else:
            data = parsed
        
        # Ensure data is a list
        if not isinstance(data, list):
            data = [data] if data else []
        
        # Check if data contains error indicators
        if isinstance(data, list) and len(data) > 0:
            first_item = data[0]
            if isinstance(first_item, dict):
                if "err_code" in first_item or "err_text" in first_item or "error" in first_item:
                    print(f"UNS: Error indicators found in children response for {request.item_id}")
                    return {
                        "success": False,
                        "has_children": False,
                        "error": None
                    }
        
        # If we have data and it's a non-empty list, item has children
        has_children = isinstance(data, list) and len(data) > 0
        
        return {
            "success": True,
            "has_children": has_children,
            "child_count": len(data) if isinstance(data, list) else 0,
            "error": None
        }
    except Exception as e:
        error_msg = str(e)
        print(f"UNS: Check children error for {request.item_id}: {error_msg}")
        # On error, assume no children
        return {
            "success": False,
            "has_children": False,
            "child_count": 0,
            "error": error_msg
        }


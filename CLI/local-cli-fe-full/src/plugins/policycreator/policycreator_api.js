const API_BASE_URL = (window._env_?.VITE_API_URL || "http://localhost:8080") + "/policycreator";

export async function submitCustomPolicy(nodeAddress, policyType, policyData) {
  if (!nodeAddress || !policyType) {
    return { error: "Missing required inputs" };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/submit-custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node: nodeAddress,
        policy_type: policyType,
        policy: policyData || {},
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { error: error.detail || "Submission failed" };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    console.error("Submit custom policy error:", err);
    return { error: "Could not connect to server" };
  }
}

export async function submitPolicy(nodeAddress, policyType, formData, memberPubkey = null, signingMemberName = null) {
  if (!nodeAddress || !policyType || !formData) {
    return { error: "Missing required inputs" };
  }

  try {
    const requestBody = {
      node: nodeAddress,
      policy_file: policyType,
      policy: formData
    };

    if (memberPubkey) {
      requestBody.member_pubkey = memberPubkey;
    }
    if (signingMemberName) {
      requestBody.signing_member_name = signingMemberName;
    }

    const response = await fetch(`${API_BASE_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      return { error: error.detail || "Submission failed" };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    console.error("Submit policy error:", err);
    return { error: "Could not connect to server" };
  }
}

export async function getPolicyTemplate(policyType) {
  try {
    const response = await fetch(`${API_BASE_URL}/policy-template/${policyType}`);
    return await response.json();
  } catch (err) {
    console.error("Failed to fetch policy template", err);
    return null;
  }
}

export async function fetchPolicyTypes() {
  try {
    const response = await fetch(`${API_BASE_URL}/policy-types`);
    const data = await response.json();

    if (response.ok && data.types) {
      return data.types;
    } else {
      console.error("Invalid policy types response:", data);
      return [];
    }
  } catch (error) {
    console.error("Error fetching policy types:", error);
    return [];
  }
}

export async function fetchCustomTypes() {
  try {
    const response = await fetch(`${API_BASE_URL}/custom-types`);
    if (!response.ok) {
      const error = await response.json();
      return { error: error.detail || "Failed to fetch custom types" };
    }
    const data = await response.json();
    return data.custom_types || [];
  } catch (err) {
    console.error("fetchCustomTypes error:", err);
    return { error: "Could not connect to server" };
  }
}

export async function fetchTypeOptions(nodeAddress, type) {
  try {
    const response = await fetch(`${API_BASE_URL}/type-options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node: nodeAddress, type }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { error: error.detail || "Failed to fetch type options" };
    }

    const data = await response.json();
    return data.options || [];
  } catch (err) {
    console.error("fetchTypeOptions error:", err);
    return { error: "Could not connect to server" };
  }
}

export async function fetchAvailablePermissions(nodeAddress) {
  try {
    const res = await fetch(`${API_BASE_URL}/permissions/${nodeAddress}`);
    if (!res.ok) return [];
    const data = await res.json();

    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.permissions)) return data.permissions;
    return [];
  } catch (err) {
    console.error("fetchAvailablePermissions error:", err);
    return [];
  }
}

export async function fetchAvailableSigningMembers(node, pubkey) {
  try {
    const response = await fetch(`${API_BASE_URL}/available-signing-members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node, pubkey }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { error: error.detail || "Failed to fetch available signing members" };
    }

    const data = await response.json();
    return { success: true, data: data.members || [] };
  } catch (err) {
    console.error("fetchAvailableSigningMembers error:", err);
    return { error: "Could not connect to server" };
  }
}

export async function assignmentSummary(node) {
  try {
    const response = await fetch(`${API_BASE_URL}/assignment-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to fetch assignment summary");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching assignment summary:", error);
    throw error;
  }
}

export async function regenerateAssignments(node, securityGroup = null) {
  try {
    const requestBody = { node };
    if (securityGroup) {
      requestBody.security_group = securityGroup;
    }

    const response = await fetch(`${API_BASE_URL}/regenerate-assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to regenerate assignments");
    }
    return await response.json();
  } catch (error) {
    console.error("Error regenerating assignments:", error);
    throw error;
  }
}

export async function debugMembers(node) {
  try {
    const response = await fetch(`${API_BASE_URL}/debug-members/${node}`);
    if (!response.ok) {
      const error = await response.json();
      return { error: error.detail || "Failed to debug members" };
    }
    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    console.error("debugMembers error:", err);
    return { error: "Could not connect to server" };
  }
}

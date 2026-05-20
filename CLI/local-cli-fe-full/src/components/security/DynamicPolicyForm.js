import React, { useState, useEffect } from 'react';
import {
  fetchAvailablePermissions as defaultFetchAvailablePermissions,
  fetchCustomTypes as defaultFetchCustomTypes,
  fetchTypeOptions as defaultFetchTypeOptions,
} from '../../services/security_api';
import PermissionsTable from './PermissionsTable';
import FieldPermissionsTable from './FieldPermissionsTable';
import SecurityGroupsTable from './SecurityGroupsTable';
import TableTable from './TableTable';
import DefaultSelector from './DefaultSelector';
import MemberSelector from './MemberSelector';
import PermissionPolicySelector from './PermissionPolicySelector';
import CustomFieldsEditor, { customFieldsToObject } from './CustomFieldsEditor';
import '../../styles/security/DynamicPolicyForm.css';

// DynamicPolicyForm renders a form based on a policy template definition
function DynamicPolicyForm({
  template, formData, onChange, node, allowedPolicyFields,
  showPreview = false, refreshTrigger = 0, currentUserPubkey = null,
  fetchAvailablePermissionsFn, fetchCustomTypesFn, fetchTypeOptionsFn,
  enableCustomFields = false,
}) {
  const fetchAvailablePermissions = fetchAvailablePermissionsFn || defaultFetchAvailablePermissions;
  const fetchCustomTypes = fetchCustomTypesFn || defaultFetchCustomTypes;
  const fetchTypeOptions = fetchTypeOptionsFn || defaultFetchTypeOptions;
  // State for dynamic options (e.g., node or table options fetched from backend)
  const [dynamicTypes, setDynamicTypes] = useState([])
  const [dynamicOptions, setDynamicOptions] = useState({});
  const [allowedFields, setAllowedFields] = useState([]);
  const [availablePermissions, setAvailablePermissions] = useState([]);
  // Track which optional object fields are enabled
  const [enabledObjects, setEnabledObjects] = useState({});

  // Function to generate the policy JSON based on form data and template
  const generatePolicyPreview = () => {
    if (!template || !formData) return null;

    const fields = (template.fields || []).filter(f => f && f.name);
    const result = {};

    for (const field of fields) {
      const name = field.name;
      const value = formData[name];

      if (field.type === 'generated') continue;

      if (field.modifiers) {
        const val = value;
        const val_str = typeof val === 'boolean' ? val.toString().toLowerCase() : String(val);
        
        const modifier = field.modifiers[val_str];
        if (modifier) {
          Object.assign(result, modifier);
        }
      } else {
        if (value !== undefined && value !== null && value !== '' && value !== '__custom__') {
          result[name] = value;
        }
      }
    }

    if (formData._customFields) {
      Object.assign(result, customFieldsToObject(formData._customFields));
    }

    return { [template.policy_type || 'policy']: result };
  };

  useEffect(() => {
    // console.log("DynamicPolicyForm template:", template);
    // console.log("Allowed Policy Fields", allowedPolicyFields)

    if (template && template.policy_type) {
      // Initialize allowed fields from the template if allowedPolicyFields is provided
      if (allowedPolicyFields) {
      const type = template.policy_type
      // console.log("DynamicPolicyForm type:", type);

      const allowed = Object.keys(allowedPolicyFields[type] || {});

      // const fields = template.fields.map(f => f.name);
      setAllowedFields(allowed);
      } else {
        // If no allowedPolicyFields, allow all fields
        setAllowedFields([]);
      }

      // Initialize field_permissions with default values if it exists
      const fieldPermissionsField = template.fields.find(f => f.name === 'field_permissions');
      console.log("Found field_permissions field:", fieldPermissionsField);
      console.log("Current formData.field_permissions:", formData.field_permissions);
      
      if (fieldPermissionsField && !formData.field_permissions) {
        const defaultFieldPermissions = {};
        
        fieldPermissionsField.fields.forEach(policyTypeField => {
          const policyType = policyTypeField.name;
          defaultFieldPermissions[policyType] = {};
          
          policyTypeField.fields.forEach(fieldDef => {
            defaultFieldPermissions[policyType][fieldDef.name] = fieldDef.default !== undefined ? fieldDef.default : true;
          });
        });
        
        console.log("Setting default field_permissions:", defaultFieldPermissions);
        onChange({ ...formData, field_permissions: defaultFieldPermissions });
      }

      // // If allowedPolicyFields is provided, filter the template fields
      // if (allowedPolicyFields) {
      //   const filteredFields = template.fields.filter(f => allowedPolicyFields.includes(f.name));
      //   template.fields = filteredFields;
      // }
    }

  }, [template, allowedPolicyFields]);

  // Fetch dynamic options for fields of type 'node' or 'table' when template or node changes
  useEffect(() => {
    async function fetchOptions() {
      if (!template || !node) return;

      // Fetch dynamic types from backend
      const customTypesResult = await fetchCustomTypes();

      // console.log(customTypesResult);

      const tempDynamicTypes = customTypesResult;
      // if (Array.isArray(customTypesResult)) {
      //   tempDynamicTypes = customTypesResult;
      // } else if (customTypesResult && Array.isArray(customTypesResult.data)) {
      //   tempDynamicTypes = customTypesResult.data;
      // } else if (customTypesResult && Array.isArray(customTypesResult.custom_types)) {
      //   tempDynamicTypes = customTypesResult.custom_types;
      // }

      setDynamicTypes(tempDynamicTypes);

      const updated = { ...dynamicOptions };

      for (const field of (template.fields || [])) {
        if (!field || !field.name || !field.type) continue;

        if (tempDynamicTypes.includes(field.type) && !updated[field.name]) {
          updated[field.name] = await fetchTypeOptions(node, field.type);
        }
      }

      setDynamicOptions(updated);

      console.log("RERANNNNNNN THAT BITTKHDJHSVBSFKJH")
      console.log(updated)

    }

    fetchOptions();
  }, [template, node, refreshTrigger]);

  useEffect(() => {
    async function getPermissions() {
      if (!node) return;
      const perms = await fetchAvailablePermissions(node);
      setAvailablePermissions(perms);

      console.log("perms", perms)
    }
    getPermissions();
  }, [node, refreshTrigger]);

  // Renders the appropriate input for a given field definition
  function renderFieldInput(field, value, onChange) {
    // Handles value changes for different field types
    const handleChange = (e) => {
      let val = e.target.value;

      switch (field.type) {
        case 'integer':
          val = parseInt(val, 10) || 0;
          break;
        case 'float':
          val = parseFloat(val) || 0;
          break;
        case 'boolean':
          val = e.target.checked;
          break;
        default:
          break;
      }

      onChange(field.name, val);
    };

    // Use dynamic options if available (for node/table fields)
    let dynamic = dynamicOptions[field.name];

    // Render SecurityGroupsTable for security_group array fields
    if (field.type === 'security_group') {
      const groups = dynamic || [];
      console.log("Security Groups Options:", groups); // Added logging
      return (
        <SecurityGroupsTable
          groups={groups}
          selectedGroups={value || []}
          onChange={(updated) => onChange(field.name, updated)}
        />
      );
    }

    if (field.type === 'table') {
      const tablegroups = dynamic || [];
      console.log("Table Options:", tablegroups); // Added logging
      return (
        <TableTable
          groups={tablegroups}
          selectedGroups={value || []}
          onChange={(updated) => onChange(field.name, updated)}
        />
      );
    }

    // Render select dropdown for select, node, or table fields
    if (field.type === 'select' || dynamicTypes.includes(field.type)) {
      const options = field.options || dynamic || [];
      const allowCustom = field.allow_custom === true;
      const inCustomMode = allowCustom && value != null && value !== '' && !options.includes(value);
      const selectValue = inCustomMode ? '__custom__' : (value || '');

      return (
        <div className="select-with-custom">
          <select
            value={selectValue}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                onChange(field.name, '__custom__');
              } else {
                onChange(field.name, e.target.value);
              }
            }}
          >
            <option value="">-- Select --</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
            {allowCustom && <option value="__custom__">Other (custom)...</option>}
          </select>
          {allowCustom && inCustomMode && (
            <input
              type="text"
              value={value === '__custom__' ? '' : value}
              onChange={(e) => {
                onChange(field.name, e.target.value || '__custom__');
              }}
              placeholder="Enter custom value"
              className="custom-select-input"
            />
          )}
        </div>
      );
    }

    if (field.type === 'permission') {
      return (
        <PermissionsTable
          permissions={availablePermissions}
          selectedPermissions={value || []}
          onChange={(updated) => onChange(field.name, updated)}
        />
      );
    }


    // Special handling for field_permissions to use table format
    if (field.name === 'field_permissions' && field.type === 'object') {
      console.log("Rendering field_permissions with value:", value);
      return (
        <FieldPermissionsTable
          fieldPermissions={value || {}}
          onChange={(updated) => onChange(field.name, updated)}
        />
      );
    }

    // Render input for other field types
    switch (field.type) {
      case 'textarea':
        return (
          <textarea value={value || ''} onChange={handleChange} rows="4" />
        );
      case 'array':
        // Special handling for members field in assignment policies
        if (field.name === 'members' && template.policy_type === 'assignment') {
          // Convert array of public keys to array of member objects for MemberSelector
          const selectedMembers = (value || []).map(pubkey => {
            // Try to find the member object from available members
            // This is a fallback - ideally we'd have the member data
            return {
              name: `Member ${pubkey.substring(0, 8)}...`,
              type: 'user',
              public_key: pubkey
            };
          });

          return (
            <div className="members-array-input">
              <MemberSelector
                node={node}
                currentUserPubkey={currentUserPubkey}
                selectedMembers={selectedMembers}
                onChange={(members) => {
                  // Convert member objects back to array of public keys
                  const publicKeys = members.map(member => member.public_key);
                  onChange(field.name, publicKeys);
                }}
                refreshTrigger={refreshTrigger}
              />
              <div className="array-fallback">
                <details>
                  <summary>Manual Entry (Fallback)</summary>
                  <div className="array-input">
                    <div className="array-list">
                      {(value || []).map((item, idx) => (
                        <div key={idx} className="array-item">
                          <input
                            type="text"
                            value={item}
                            onChange={(e) => {
                              const newArray = [...value];
                              newArray[idx] = e.target.value;
                              onChange(field.name, newArray);
                            }}
                            placeholder="Enter public key"
                          />
                          <button onClick={() => {
                            const newArray = (value || []).filter((_, i) => i !== idx);
                            onChange(field.name, newArray);
                          }}>Remove</button>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => onChange(field.name, [...(value || []), ""])}>Add Public Key</button>
                  </div>
                </details>
              </div>
            </div>
          );
        }

        // Default array input for other fields
        return (
          <div className="array-input">
            <div className="array-list">
              {(value || []).map((item, idx) => (
                <div key={idx} className="array-item">
                  <input
                    type="text"
                    value={item}
                    onChange={(e) => {
                      const newArray = [...value];
                      newArray[idx] = e.target.value;
                      onChange(field.name, newArray);
                    }}
                  />
                  <button onClick={() => {
                    const newArray = (value || []).filter((_, i) => i !== idx);
                    onChange(field.name, newArray);
                  }}>Remove</button>
                </div>
              ))}
            </div>
            <button onClick={() => onChange(field.name, [...(value || []), ""])}>Add Item</button>
          </div>
        );
      case 'boolean':
        return (
          <input type="checkbox" checked={value || false} onChange={handleChange} />
        );
      case 'integer':
      case 'float':
        return (
          <input type="number" value={value || ''} onChange={handleChange} />
        );
      case 'object': {
        const isOptional = !field.required;
        const isEnabled = isOptional ? (enabledObjects[field.name] ?? (value != null && Object.keys(value || {}).length > 0)) : true;

        const toggleEnabled = () => {
          if (isEnabled) {
            onChange(field.name, undefined);
            setEnabledObjects(prev => ({ ...prev, [field.name]: false }));
          } else {
            setEnabledObjects(prev => ({ ...prev, [field.name]: true }));
          }
        };

        return (
          <div className="object-field-wrapper">
            {isOptional && (
              <div className="object-toggle">
                <label className="object-toggle-label">
                  <input type="checkbox" checked={isEnabled} onChange={toggleEnabled} />
                  Enable {field.label || field.name}
                </label>
                {isEnabled && value && Object.keys(value).length > 0 && (
                  <button
                    type="button"
                    className="object-clear-btn"
                    onClick={() => { onChange(field.name, undefined); setEnabledObjects(prev => ({ ...prev, [field.name]: false })); }}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
            {isEnabled && (
              <div style={{ marginLeft: 16, paddingLeft: 8, borderLeft: '2px solid #e5e7eb' }}>
                {field.fields && field.fields.map((subField) => (
                  <div key={subField.name} style={{ marginTop: 8 }}>
                    <label>
                      {subField.label || subField.name}
                      {subField.required && <span className="required-asterisk"> *</span>}
                      <span className="tooltip-icon">ⓘ
                        <span className="tooltip-text">
                          {subField.description} {subField.required ? "(Required)" : ""}
                        </span>
                      </span>
                    </label>
                    {renderFieldInput(
                      subField,
                      (value && typeof value === 'object') ? value[subField.name] : undefined,
                      (subName, subVal) => {
                        const newObj = { ...(value && typeof value === 'object' ? value : {}) };
                        newObj[subName] = subVal;
                        onChange(field.name, newObj);
                      }
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }
      default:
        // Special handling for permissions field in assignment policies
        if (field.name === 'permissions' && template.policy_type === 'assignment') {
          return (
            <div className="permissions-text-input">
              <PermissionPolicySelector
                node={node}
                selectedPermissionId={value}
                onChange={(permissionId) => onChange(field.name, permissionId)}
                refreshTrigger={refreshTrigger}
              />
              <div className="text-input-fallback">
                <details>
                  <summary>Manual Entry (Fallback)</summary>
                  <input 
                    type="text" 
                    value={value || ''} 
                    onChange={handleChange}
                    placeholder="Enter permission policy ID manually"
                    className="fallback-input"
                  />
                </details>
              </div>
            </div>
          );
        }

        // Default to text input for unknown types
        return (
          <input type="text" value={value || ''} onChange={handleChange} />
        );
    }
  }

  // Capitalizes the first letter of a string (for display)
  function capitalizeFirstLetter(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // If no template or fields, render nothing
  if (!template || !Array.isArray(template.fields)) return null;

  // Normalise fields: skip entries without a name, apply safe defaults
  const safeFields = template.fields
    .filter(f => f && f.name)
    .map(f => ({
      ...f,
      label: f.label || f.name,
      type: f.type || 'text',
      description: f.description || '',
      required: f.required ?? false,
    }));

  const policyPreview = generatePolicyPreview();

  // Main render: two-column layout with form and preview
  return (
    <div className={`dynamic-policy-form ${showPreview ? 'two-column-layout' : ''}`}>
      <div className="form-column">
      <h4>{capitalizeFirstLetter(template.name)} Form</h4>
      
      {/* Default Selector */}
      {template.defaults && (
        <DefaultSelector
          defaults={template.defaults}
          onSelectDefault={(defaultData) => onChange(defaultData)}
          currentFormData={formData}
        />
      )}
      
      {safeFields.map((field) => {
        if (field.type === 'generated') return null; // Skip generated fields

        // If allowedPolicyFields is provided, skip fields not in the allowed list
        if (allowedFields.length > 0 && !allowedFields.includes(field.name)) {
          return null; // Skip fields not in allowed list
        }

        const hasValue = (() => {
          const v = formData[field.name];
          if (v === undefined || v === null || v === '') return false;
          if (Array.isArray(v) && v.length === 0) return false;
          if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
          return true;
        })();

        return (
          <div key={field.name} className="dynamic-policy-form-field">
            <div className="dynamic-policy-form-label-row">
              <label className="dynamic-policy-form-label">
                {field.label}
                {field.required && <span className="required-asterisk"> *</span>}
                <span className="tooltip-icon">ⓘ
                  <span className="tooltip-text">
                    {field.description} {field.required ? "(Required)" : ""}
                  </span>
                </span>
              </label>
              {hasValue && (
                <button
                  type="button"
                  className="field-clear-btn"
                  onClick={() => {
                    const cleared = { ...formData };
                    delete cleared[field.name];
                    if (field.type === 'object') {
                      setEnabledObjects(prev => ({ ...prev, [field.name]: false }));
                    }
                    onChange(cleared);
                  }}
                  title={`Clear ${field.label}`}
                >
                  Clear
                </button>
              )}
            </div>
            {renderFieldInput(field, formData[field.name], (name, val) => onChange({ ...formData, [name]: val }))}
          </div>
        );
      })}

      {enableCustomFields && (
        <CustomFieldsEditor
          fields={formData._customFields || []}
          onChange={(fields) => onChange({ ...formData, _customFields: fields })}
        />
      )}
      </div>
      
      {showPreview && (
        <div className="preview-column">
          <h4>Policy Preview</h4>
          <div className="policy-preview">
            <pre>{JSON.stringify(policyPreview, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default DynamicPolicyForm;

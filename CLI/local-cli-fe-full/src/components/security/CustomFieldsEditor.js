import React, { useState } from 'react';
import '../../styles/security/CustomFieldsEditor.css';

const VALUE_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'object', label: 'Object (nested)' },
  { value: 'array', label: 'List' },
];

function CustomFieldValue({ field, onFieldChange, onRemove, depth = 0 }) {
  const handleKeyChange = (e) => {
    onFieldChange({ ...field, key: e.target.value });
  };

  const handleTypeChange = (e) => {
    const newType = e.target.value;
    let newValue;
    switch (newType) {
      case 'object': newValue = []; break;
      case 'array': newValue = ['']; break;
      case 'boolean': newValue = false; break;
      case 'number': newValue = 0; break;
      default: newValue = '';
    }
    onFieldChange({ ...field, type: newType, value: newValue });
  };

  const handleValueChange = (e) => {
    let val = e.target.value;
    if (field.type === 'number') val = parseFloat(val) || 0;
    onFieldChange({ ...field, value: val });
  };

  const handleBoolChange = (e) => {
    onFieldChange({ ...field, value: e.target.checked });
  };

  const handleNestedFieldsChange = (nestedFields) => {
    onFieldChange({ ...field, value: nestedFields });
  };

  const handleArrayItemChange = (idx, val) => {
    const items = [...(field.value || [])];
    items[idx] = val;
    onFieldChange({ ...field, value: items });
  };

  const addArrayItem = () => {
    onFieldChange({ ...field, value: [...(field.value || []), ''] });
  };

  const removeArrayItem = (idx) => {
    const items = (field.value || []).filter((_, i) => i !== idx);
    onFieldChange({ ...field, value: items });
  };

  const renderValueInput = () => {
    switch (field.type) {
      case 'boolean':
        return (
          <label className="cfe-bool-label">
            <input type="checkbox" checked={!!field.value} onChange={handleBoolChange} />
            {field.value ? 'true' : 'false'}
          </label>
        );

      case 'object':
        return (
          <div className="cfe-nested">
            <CustomFieldsEditor
              fields={field.value || []}
              onChange={handleNestedFieldsChange}
              depth={depth + 1}
            />
          </div>
        );

      case 'array':
        return (
          <div className="cfe-array">
            {(field.value || []).map((item, idx) => (
              <div key={idx} className="cfe-array-item">
                <input
                  type="text"
                  value={item}
                  onChange={(e) => handleArrayItemChange(idx, e.target.value)}
                  placeholder={`Item ${idx + 1}`}
                />
                <button
                  type="button"
                  className="cfe-remove-btn cfe-remove-sm"
                  onClick={() => removeArrayItem(idx)}
                  title="Remove item"
                >×</button>
              </div>
            ))}
            <button type="button" className="cfe-add-btn cfe-add-sm" onClick={addArrayItem}>
              + Item
            </button>
          </div>
        );

      case 'number':
        return (
          <input
            type="number"
            value={field.value ?? ''}
            onChange={handleValueChange}
            placeholder="Value"
            className="cfe-value-input"
          />
        );

      default:
        return (
          <input
            type="text"
            value={field.value ?? ''}
            onChange={handleValueChange}
            placeholder="Value"
            className="cfe-value-input"
          />
        );
    }
  };

  return (
    <div className={`cfe-field depth-${Math.min(depth, 4)}`}>
      <div className="cfe-field-header">
        <input
          type="text"
          value={field.key}
          onChange={handleKeyChange}
          placeholder="Field name"
          className="cfe-key-input"
        />
        <select value={field.type} onChange={handleTypeChange} className="cfe-type-select">
          {VALUE_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="cfe-remove-btn"
          onClick={onRemove}
          title="Remove field"
        >×</button>
      </div>
      <div className="cfe-field-value">
        {renderValueInput()}
      </div>
    </div>
  );
}

function CustomFieldsEditor({ fields, onChange, depth = 0 }) {
  const [collapsed, setCollapsed] = useState(false);

  const addField = () => {
    onChange([...fields, { key: '', type: 'text', value: '' }]);
  };

  const updateField = (idx, updated) => {
    const next = [...fields];
    next[idx] = updated;
    onChange(next);
  };

  const removeField = (idx) => {
    onChange(fields.filter((_, i) => i !== idx));
  };

  if (depth > 0 && fields.length > 0) {
    return (
      <div className="cfe-container">
        {fields.map((field, idx) => (
          <CustomFieldValue
            key={idx}
            field={field}
            onFieldChange={(updated) => updateField(idx, updated)}
            onRemove={() => removeField(idx)}
            depth={depth}
          />
        ))}
        <button type="button" className="cfe-add-btn" onClick={addField}>
          + Add Nested Field
        </button>
      </div>
    );
  }

  return (
    <div className="cfe-section">
      <div className="cfe-section-header" onClick={() => setCollapsed(!collapsed)}>
        <h4>
          <span className={`cfe-chevron ${collapsed ? '' : 'open'}`}>&#9654;</span>
          Custom Fields
          {fields.length > 0 && <span className="cfe-badge">{fields.length}</span>}
        </h4>
        <span className="cfe-section-hint">Add arbitrary key-value pairs with unlimited nesting</span>
      </div>
      {!collapsed && (
        <div className="cfe-container">
          {fields.map((field, idx) => (
            <CustomFieldValue
              key={idx}
              field={field}
              onFieldChange={(updated) => updateField(idx, updated)}
              onRemove={() => removeField(idx)}
              depth={depth}
            />
          ))}
          <button type="button" className="cfe-add-btn" onClick={addField}>
            + Add Custom Field
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Convert the internal fields array representation to a plain object
 * suitable for merging into form data / sending to the API.
 */
export function customFieldsToObject(fields) {
  const obj = {};
  for (const field of fields) {
    if (!field.key || field.key.trim() === '') continue;
    const k = field.key.trim();
    if (field.type === 'object') {
      obj[k] = customFieldsToObject(field.value || []);
    } else {
      obj[k] = field.value;
    }
  }
  return obj;
}

export default CustomFieldsEditor;

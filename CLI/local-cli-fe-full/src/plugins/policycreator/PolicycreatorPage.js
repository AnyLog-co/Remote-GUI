import React, { useState, useEffect } from 'react';
import PolicySelector from '../../components/security/PolicySelector';
import DynamicPolicyForm from '../../components/security/DynamicPolicyForm';
import SignWithSelector from '../../components/security/SignWithSelector';
import CustomFieldsEditor, { customFieldsToObject } from '../../components/security/CustomFieldsEditor';
import {
  getPolicyTemplate,
  submitPolicy,
  submitCustomPolicy,
  fetchPolicyTypes,
  fetchCustomTypes,
  fetchTypeOptions,
  fetchAvailablePermissions,
  fetchAvailableSigningMembers,
} from './policycreator_api';
import '../../styles/security/PolicyGeneratorPage.css';

export const pluginMetadata = {
  name: 'Policy Creator',
  // icon: '📋',
};

const MODE_TEMPLATE = 'template';
const MODE_CUSTOM = 'custom';

function PolicycreatorPage({ node }) {
  const [mode, setMode] = useState(MODE_TEMPLATE);

  // Template mode state
  const [policyType, setPolicyType] = useState('');
  const [formTemplate, setFormTemplate] = useState(null);
  const [formData, setFormData] = useState({});
  const [signingMember, setSigningMember] = useState('');

  // Custom mode state
  const [customPolicyType, setCustomPolicyType] = useState('');
  const [customFields, setCustomFields] = useState([]);

  // Shared state
  const [response, setResponse] = useState(null);
  const [showPreview, setShowPreview] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    if (!policyType) return;
    setFormTemplate(null);
    setFormData({});
    getPolicyTemplate(policyType).then((template) => {
      if (template) setFormTemplate(template);
    });
  }, [policyType]);

  const handleModeChange = (newMode) => {
    setMode(newMode);
    setResponse(null);
  };

  // --- Template submit ---
  const handleTemplateSubmit = async () => {
    if (!node) {
      alert('Please select a node from the top bar before submitting a policy.');
      return;
    }

    const missingFields = (formTemplate.fields || [])
      .filter(f => f && f.name && f.required && f.type !== "generated")
      .filter(f => {
        const val = formData[f.name];
        return val === undefined || val === null || val === '';
      });

    if (missingFields.length > 0) {
      alert(`Please fill out all required fields: ${missingFields.map(f => f.name).join(", ")}`);
      return;
    }

    if (formTemplate.requires_signature && policyType !== "member_policy" && !signingMember) {
      alert('Please select a member to sign the policy with');
      return;
    }

    setIsSubmitting(true);
    setResponse(null);

    try {
      const { _customFields, ...templateFields } = formData;
      const customData = _customFields ? customFieldsToObject(_customFields) : {};
      const merged = { ...templateFields, ...customData };
      const submitData = Object.fromEntries(
        Object.entries(merged).filter(([, v]) => v !== '__custom__')
      );

      const signingMemberToUse = (formTemplate.requires_signature && policyType !== "member_policy") ? signingMember : null;
      const result = await submitPolicy(node, policyType, submitData, null, signingMemberToUse);

      if (result.success) {
        setResponse({ status: 'success', policy: result.data[result.data.length - 1] });
        setRefreshTrigger(prev => prev + 1);
      } else {
        setResponse({ status: 'error', message: result.error });
      }
    } catch (error) {
      console.error('Error submitting policy:', error);
      setResponse({ status: 'error', message: 'An unexpected error occurred while submitting the policy.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Custom submit ---
  const handleCustomSubmit = async () => {
    if (!node) {
      alert('Please select a node from the top bar before submitting a policy.');
      return;
    }
    if (!customPolicyType.trim()) {
      alert('Please enter a policy type name.');
      return;
    }
    if (customFields.length === 0) {
      alert('Please add at least one field to the policy.');
      return;
    }

    setIsSubmitting(true);
    setResponse(null);

    try {
      const policyData = customFieldsToObject(customFields);
      const result = await submitCustomPolicy(node, customPolicyType.trim(), policyData);

      if (result.success) {
        const data = result.data;
        const lastPolicy = Array.isArray(data) ? data[data.length - 1] : data;
        setResponse({ status: 'success', policy: lastPolicy });
        setRefreshTrigger(prev => prev + 1);
      } else {
        setResponse({ status: 'error', message: result.error });
      }
    } catch (error) {
      console.error('Error submitting custom policy:', error);
      setResponse({ status: 'error', message: 'An unexpected error occurred while submitting the policy.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const customFieldData = customFieldsToObject(customFields);
  const customPreview = customPolicyType.trim()
    ? { [customPolicyType.trim()]: customFieldData }
    : (Object.keys(customFieldData).length > 0 ? { '<policy_type>': customFieldData } : null);

  return (
    <div className="policy-generator">
      <div className="page-header">
        <h2>Policy Creator</h2>
        {node ? (
          <p className="node-info">Connected to: <strong>{node}</strong></p>
        ) : (
          <p className="node-warning">Please select a node from the top bar to continue</p>
        )}
      </div>

      {/* Mode switcher */}
      {node && (
        <div className="mode-switcher">
          <button
            className={`mode-btn ${mode === MODE_TEMPLATE ? 'active' : ''}`}
            onClick={() => handleModeChange(MODE_TEMPLATE)}
          >
            From Template
          </button>
          <button
            className={`mode-btn ${mode === MODE_CUSTOM ? 'active' : ''}`}
            onClick={() => handleModeChange(MODE_CUSTOM)}
          >
            Custom Policy
          </button>
        </div>
      )}

      {/* ─── Template mode ─── */}
      {node && mode === MODE_TEMPLATE && (
        <>
          <PolicySelector
            value={policyType}
            onChange={setPolicyType}
            allowedPolicyTypes={['uns']}
            fetchPolicyTypesFn={fetchPolicyTypes}
          />

          {formTemplate && (
            <div className="form-controls">
              <div className="preview-toggle">
                <button onClick={() => setShowPreview(!showPreview)} className="preview-toggle-button">
                  {showPreview ? 'Hide Preview' : 'Show Preview'}
                </button>
              </div>
            </div>
          )}

          {formTemplate && (
            <DynamicPolicyForm
              template={formTemplate}
              formData={formData}
              node={node}
              onChange={setFormData}
              allowedPolicyFields={null}
              showPreview={showPreview}
              refreshTrigger={refreshTrigger}
              currentUserPubkey={null}
              fetchAvailablePermissionsFn={fetchAvailablePermissions}
              fetchCustomTypesFn={fetchCustomTypes}
              fetchTypeOptionsFn={fetchTypeOptions}
              enableCustomFields={true}
            />
          )}

          {formTemplate && formTemplate.requires_signature && policyType !== "member_policy" && (
            <SignWithSelector
              node={node}
              currentUserPubkey={null}
              selectedMember={signingMember}
              onMemberChange={setSigningMember}
              disabled={isSubmitting}
              refreshTrigger={refreshTrigger}
              fetchAvailableSigningMembersFn={fetchAvailableSigningMembers}
            />
          )}

          {formTemplate && policyType === "member_policy" && (
            <div className="member-policy-signing-info">
              <div className="info-box">
                <h4>Member Policy Signing</h4>
                <p>
                  <strong>Note:</strong> When creating a new member policy, the new member will automatically
                  sign the policy themselves after their cryptographic keys are created.
                </p>
              </div>
            </div>
          )}

          {formTemplate && (
            <button onClick={handleTemplateSubmit} disabled={isSubmitting || !node} className="submit-button">
              {isSubmitting ? 'Submitting...' : 'Submit Policy'}
            </button>
          )}
        </>
      )}

      {/* ─── Custom mode ─── */}
      {node && mode === MODE_CUSTOM && (
        <div className="custom-policy-builder">
          <div className="form-controls">
            <div className="preview-toggle">
              <button onClick={() => setShowPreview(!showPreview)} className="preview-toggle-button">
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </button>
            </div>
          </div>

          <div className={`custom-policy-layout ${showPreview ? 'two-column-layout' : ''}`}>
            <div className="form-column">
              <div className="dynamic-policy-form-field">
                <label className="dynamic-policy-form-label">Policy Type *</label>
                <input
                  type="text"
                  value={customPolicyType}
                  onChange={(e) => setCustomPolicyType(e.target.value)}
                  placeholder="e.g. uns, config, device, sensor..."
                  className="custom-policy-type-input"
                />
              </div>

              <CustomFieldsEditor
                fields={customFields}
                onChange={setCustomFields}
              />
            </div>

            {showPreview && (
              <div className="preview-column">
                <h4>Policy Preview</h4>
                <div className="policy-preview">
                  <pre>{customPreview ? JSON.stringify(customPreview, null, 2) : '{ }'}</pre>
                </div>
              </div>
            )}
          </div>

          <button onClick={handleCustomSubmit} disabled={isSubmitting || !node} className="submit-button">
            {isSubmitting ? 'Submitting...' : 'Submit Custom Policy'}
          </button>
        </div>
      )}

      {/* ─── Shared: loading + response ─── */}
      {isSubmitting && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="loading-spinner"></div>
            <p>Submitting policy...</p>
          </div>
        </div>
      )}

      {response && (
        <div className="response">
          <h4>Response:</h4>
          <pre>{JSON.stringify(response, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default PolicycreatorPage;

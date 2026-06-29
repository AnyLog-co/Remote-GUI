

import React, { useState, useRef, useEffect } from 'react';
import MonitorTable from '../components/MonitorTable';
import { monitor } from '../services/api'; // Ensure your API is set up correctly
import '../styles/Monitor.css';

const Monitor = ({ node }) => {
  console.log("Monitor node: ", node);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Rerun rate in seconds: must be 0 or a multiple of 20.
  const [rerunRate, setRerunRate] = useState(20);
  const [inputError, setInputError] = useState(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  
  // Ref to store the polling interval
  const intervalRef = useRef(null);

  // Function to fetch monitoring data from the API using the current node.
  const fetchMonitoringData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Pass the node parameter as needed.
      const result = await monitor({ node });
      console.log("Monitoring result:", result);
      // Assume API returns result.data (an array of objects)
      setData(result.data);
    } catch (err) {
      setError("Error occurred while monitoring: " + (err.message || err));
    }
    setLoading(false);
  };

  // Start monitoring: fetch data immediately and, if rerunRate is greater than 0, set up an interval.
  const handleStartMonitoring = () => {
    setIsMonitoring(true);
    fetchMonitoringData();
    // Clear any existing interval.
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    // If the rerunRate is greater than 0, set an interval.
    if (rerunRate > 0) {
      intervalRef.current = setInterval(() => {
        fetchMonitoringData();
      }, rerunRate * 1000);
    }
  };

  // Stop monitoring by clearing the interval.
  const handleStopMonitoring = () => {
    setIsMonitoring(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Clear the interval when the component unmounts.
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Auto-dismiss error messages after 5 seconds
  useEffect(() => {
    if (inputError) {
      const timer = setTimeout(() => {
        setInputError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [inputError]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Handle changes to the rerun rate input.
  const handleRerunRateChange = (e) => {
    const newRate = parseInt(e.target.value, 10);
    if (isNaN(newRate)) {
      setInputError("Please enter a valid number.");
      return;
    }
    // Check if newRate is 0 or a multiple of 20.
    if (newRate % 20 !== 0) {
      setInputError("Rerun rate must be 0 or a multiple of 20.");
      return;
    }
    setInputError(null);
    setRerunRate(newRate);
    // If monitoring is running, reset the interval with the new rate.
    if (intervalRef.current) {
      handleStopMonitoring();
      // Only restart if newRate is greater than 0; if it's 0, just run once.
      if (newRate > 0) {
        handleStartMonitoring();
      }
    }
  };

  return (
    <div className="monitor-container">
      <h2>Monitor Node Section</h2>
      <div className="monitor-summary">
        <p>
          <strong>Connected Node:</strong> {node}
        </p>
        <div className="monitor-controls-row">
          <label htmlFor="rerunRate">
            {isMonitoring ? 'Refresh Rate (seconds):' : 'Refresh Paused:'}
          </label>
          <input
            className="monitor-rate-input"
            id="rerunRate"
            type="number"
            min="0"
            step="20"
            value={rerunRate}
            onChange={handleRerunRateChange}
            disabled={!isMonitoring}
          />
          {inputError && <span className="monitor-error-text">{inputError} <span className="error-dismiss" onClick={() => setInputError(null)}>×</span></span>}
          {isMonitoring && (
            <span className="monitoring-status status-active">
              <span className="status-indicator status-active-dot"></span>
              Monitoring Active
            </span>
          )}
          {!isMonitoring && (
            <span className="monitoring-status status-paused">
              <span className="status-indicator status-paused-dot"></span>
              Monitoring Paused
            </span>
          )}
        </div>
      </div>
      <div className="monitor-actions-row">
        <button 
          onClick={handleStartMonitoring}
          className="monitor-button start-monitoring-btn"
          disabled={loading}
        >
          {loading ? 'Monitoring...' : 'Start Monitoring'}
        </button>
        <button 
          onClick={handleStopMonitoring} 
          className="monitor-button stop-monitoring-btn"
          disabled={!isMonitoring}
        >
          Stop Monitoring
        </button>
      </div>
      {error && <p className="monitor-error-text"><span className="error-dismiss" onClick={() => setError(null)}>×</span>{error}</p>}
      {data && data.length > 0 && <MonitorTable data={data} />}
    </div>
  );
};

export default Monitor;

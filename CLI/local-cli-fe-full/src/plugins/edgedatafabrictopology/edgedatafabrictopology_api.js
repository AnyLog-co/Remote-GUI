import { getColumns, getTables, sendCommand } from '../../services/api';

const MONITORING_DBMS = 'monitoring';
const TABLES = {
  syslog: 'syslog'
};
const NODE_METRICS_QUERY = 'get monitored operators';
const MONITORING_STATUS_QUERY = 'get monitored';

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function maybeJson(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  try {
    return JSON.parse(text);
  } catch (_) {
    return value;
  }
}

function rowsFromText(value) {
  if (typeof value !== 'string') return [];
  const text = value.trim();
  if (!text) return [];
  if (isErrorValue(text)) return [];
  const matches = [...text.matchAll(/([A-Za-z0-9_.:@/-]+@)?((?:\d{1,3}\.){3}\d{1,3}:\d{2,5})/g)];
  if (matches.length > 0) {
    return matches.map((match, index) => {
      const prefix = match[1] ? match[1].slice(0, -1) : '';
      const ipPort = match[2];
      return {
        id: prefix ? `${prefix}@${ipPort}` : ipPort,
        name: prefix || ipPort,
        ip_port: ipPort,
        row_index: index
      };
    });
  }
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^[-+| ]+$/.test(line))
    .map((line, index) => ({ id: line, name: line, ip_port: line, row_index: index }));
}

function rowsFromObjectValues(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const values = Object.entries(value)
    .filter(([, item]) => item && typeof item === 'object' && !Array.isArray(item))
    .map(([key, item]) => {
      const keyedByIpPort = /^(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}$/.test(key);
      return keyedByIpPort ? { ...item, ip_port: item.ip_port || key, id: item.id || key } : item;
    });
  return values;
}

function extractRows(payload) {
  const parsed = maybeJson(payload);
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'string') return rowsFromText(parsed);
  if (!parsed || typeof parsed !== 'object') return [];

  const data = maybeJson(parsed.data);
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') return rowsFromText(data);
  if (data && typeof data === 'object') {
    if (Array.isArray(data.Query)) return data.Query;
    if (Array.isArray(data.query)) return data.query;
    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.data)) return data.data;
    const arrayKey = Object.keys(data).find(key => Array.isArray(data[key]));
    if (arrayKey) return data[arrayKey];
    const objectRows = rowsFromObjectValues(data);
    if (objectRows.length > 0) return objectRows;
    return [data];
  }

  if (Array.isArray(parsed.Query)) return parsed.Query;
  if (Array.isArray(parsed.query)) return parsed.query;
  if (Array.isArray(parsed.rows)) return parsed.rows;
  const arrayKey = Object.keys(parsed).find(key => Array.isArray(parsed[key]));
  if (arrayKey) return parsed[arrayKey];
  const objectRows = rowsFromObjectValues(parsed);
  if (objectRows.length > 0) return objectRows;
  return [];
}

function extractStatistics(payload) {
  const parsed = maybeJson(payload);
  if (!parsed || typeof parsed !== 'object') return [];

  const candidates = [
    parsed.Statistics,
    parsed.statistics,
    parsed.data?.Statistics,
    parsed.data?.statistics
  ];

  const additionalContent = maybeJson(parsed.additional_content);
  if (additionalContent && typeof additionalContent === 'object') {
    candidates.push(additionalContent.Statistics, additionalContent.statistics);
  }

  return candidates.find(Array.isArray) || [];
}

function returnedDataLists(payload) {
  const parsed = maybeJson(payload);
  const lists = [];
  const visit = (value, key = '') => {
    const parsedValue = maybeJson(value);
    if (Array.isArray(parsedValue)) {
      if (!/statistics?/i.test(key)) lists.push(parsedValue);
      return;
    }
    if (!parsedValue || typeof parsedValue !== 'object') return;
    Object.entries(parsedValue).forEach(([childKey, childValue]) => visit(childValue, childKey));
  };

  visit(parsed);
  return lists;
}

function responseText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function isNetworkConnectionError(value) {
  const text = responseText(value).toLowerCase();
  return (
    text.includes('failed to execute get for "get monitored"') ||
    text.includes("failed to execute get for 'get monitored'") ||
    (text.includes('get monitored') && text.includes('failed to execute get')) ||
    text.includes('httpconnectionpool') ||
    text.includes('max retries exceeded') ||
    text.includes('connection refused') ||
    text.includes('failed to establish a new connection')
  );
}

async function runAnyLog(connectInfo, command, method = 'GET') {
  const startedAt = performance.now();
  try {
    const response = await sendCommand({ connectInfo, method, command, rawText: false });
    const rows = extractRows(response);
    const statistics = extractStatistics(response);
    return {
      ok: true,
      command,
      rows,
      statistics,
      rowCount: rows.length,
      durationMs: Math.round(performance.now() - startedAt),
      response
    };
  } catch (error) {
    return {
      ok: false,
      command,
      rows: [],
      rowCount: 0,
      durationMs: Math.round(performance.now() - startedAt),
      error: error.message || String(error)
    };
  }
}

async function runMonitoredOperators(connectInfo) {
  return runAnyLog(connectInfo, NODE_METRICS_QUERY);
}

export async function fetchEdgeDataFabricNodeMetrics(connectInfo) {
  if (!connectInfo) {
    return {
      ok: false,
      command: NODE_METRICS_QUERY,
      rows: [],
      statistics: [],
      rowCount: 0,
      durationMs: 0,
      error: 'Node is required.'
    };
  }
  return runMonitoredOperators(connectInfo);
}

export async function fetchEdgeDataFabricMonitoringStatus(connectInfo) {
  if (!connectInfo) {
    return {
      ok: false,
      command: MONITORING_STATUS_QUERY,
      rows: [],
      statistics: [],
      rowCount: 0,
      durationMs: 0,
      networkDisconnected: false,
      monitoringDisabled: false,
      error: 'Node is required.'
    };
  }
  const result = await runAnyLog(connectInfo, MONITORING_STATUS_QUERY);
  const lists = returnedDataLists(result.response);
  const networkDisconnected = isNetworkConnectionError(result.error || result.response);
  return {
    ...result,
    networkDisconnected,
    monitoringDisabled: !networkDisconnected && result.ok && (result.rows.length === 0 || lists.some(list => list.length === 0))
  };
}

function escapeSql(sql) {
  return String(sql).replace(/"/g, '\\"');
}

function escapeAnyLogQuoted(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function embeddedIpPort(value) {
  const match = String(value || '').match(/(?:^|@|\s)((?:\d{1,3}\.){3}\d{1,3}:\d{2,5})(?:$|\s)/);
  return match?.[1] || '';
}

function nodeNameBase(value) {
  const text = String(value || '').trim();
  return text.includes('@') ? text.split('@')[0] : '';
}

function operatorIpPortCommand(company) {
  if (company) {
    return `blockchain get operator where company = "${escapeAnyLogQuoted(company)}" bring.ip_port`;
  }
  return 'blockchain get operator bring.ip_port';
}

function operatorMetadataCommand(company) {
  if (company) {
    return `blockchain get operator where company = "${escapeAnyLogQuoted(company)}" bring.json`;
  }
  return 'blockchain get operator bring.json';
}

function policyMetadataCommand(policyType) {
  return `blockchain get ${policyType} bring.json`;
}

function virtualTablesCommand(company) {
  return `get virtual tables where company = "${escapeAnyLogQuoted(company)}"`;
}

async function runSql(connectInfo, dbms, sql, clientFilterCommand = '') {
  return runAnyLog(connectInfo, `run client (${clientFilterCommand}) sql ${dbms} format = json "${escapeSql(sql)}"`);
}

export async function runEdgeDataFabricQuery(connectInfo, dbms, sql) {
  if (!connectInfo || !dbms || !sql) {
    return {
      ok: false,
      command: '',
      rows: [],
      statistics: [],
      rowCount: 0,
      durationMs: 0,
      error: 'Node, DBMS, and query are required.'
    };
  }
  return runSql(connectInfo, dbms, sql);
}

export async function fetchEdgeDataFabricTables(connectInfo, dbms, company = '') {
  if (!connectInfo || !dbms) return [];
  let rows = [];
  if (company) {
    const result = await runAnyLog(
      connectInfo,
      `get data nodes where format=json and company="${escapeAnyLogQuoted(company)}" and dbms="${escapeAnyLogQuoted(dbms)}"`
    );
    if (!result.ok) {
      throw new Error(result.error || 'Failed to fetch company tables.');
    }
    rows = parseTableRows(result.rows, { dbms, company });
  } else {
    const response = await getTables({ connectInfo, database: dbms });
    rows = Array.isArray(response?.data) ? response.data : [];
  }
  return rows
    .map(item => cleanMetadataName(item?.table_name || item?.table || item?.Table || item?.name))
    .filter(Boolean)
    .filter((table, index, tables) => tables.indexOf(table) === index)
    .sort((left, right) => left.localeCompare(right));
}

function parseColumnRows(rows) {
  const columns = rows.flatMap(row => {
    if (!row) return [];
    if (typeof row === 'string' || typeof row === 'number') return [{ name: String(row), type: '' }];
    if (typeof row !== 'object') return [];

    const direct = row.name || row.column || row.column_name || row.columnName || row.Column || row['Column Name'];
    const directType = row.type || row.data_type || row.dataType || row.column_type || row.columnType || row.Type || row['Column Type'] || row['Data Type'];
    if (direct && typeof direct !== 'object') return [{ name: String(direct), type: directType ? String(directType) : '' }];

    return Object.entries(row).flatMap(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number') {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedKey.includes('column') || normalizedKey === 'name') {
          return [{ name: String(value), type: directType ? String(directType) : '' }];
        }
        if (!['type', 'datatype', 'columntype', 'rowindex'].includes(normalizedKey)) {
          return [{ name: key, type: String(value) }];
        }
        return [];
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = value.name || value.column || value.column_name || value.columnName;
        const nestedType = value.type || value.data_type || value.dataType || value.column_type || value.columnType || value.Type || value['Column Type'] || value['Data Type'];
        return nested || nestedType ? [{ name: String(nested || key), type: nestedType ? String(nestedType) : '' }] : [];
      }
      return [];
    });
  });

  const unique = new Map();
  columns.forEach(column => {
    const name = cleanMetadataName(column.name);
    if (!name) return;
    const type = cleanMetadataName(column.type);
    if (!unique.has(name) || (!unique.get(name).type && type)) {
      unique.set(name, { name, type });
    }
  });
  return [...unique.values()];
}

export async function fetchEdgeDataFabricColumns(connectInfo, dbms, table) {
  if (!connectInfo || !dbms || !table) return [];
  const response = await getColumns({ connectInfo, database: dbms, table });
  const rows = Array.isArray(response?.data) ? response.data : [];
  return parseColumnRows(rows);
}

async function firstSuccessfulSql(connectInfo, dbms, sqlCandidates, clientFilterCommand = '') {
  const attempts = [];
  for (const sql of sqlCandidates) {
    const result = await runSql(connectInfo, dbms, sql, clientFilterCommand);
    attempts.push(result);
    if (result.ok && result.rows.length > 0) {
      return { result, attempts };
    }
  }
  return { result: attempts[attempts.length - 1] || null, attempts };
}

function intervalQueries(table, refreshSeconds, hours, projection, limit) {
  const seconds = Math.max(1, Number(refreshSeconds) || 60);
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return [
    `SELECT ${projection} FROM ${table} WHERE timestamp >= NOW() - ${seconds} seconds ORDER BY timestamp DESC LIMIT ${limit}`,
    `SELECT ${projection} FROM ${table} WHERE timestamp >= NOW() - ${minutes} minutes ORDER BY timestamp DESC LIMIT ${limit}`,
    `SELECT ${projection} FROM ${table} WHERE timestamp >= NOW() - ${hours} hours ORDER BY timestamp DESC LIMIT ${limit}`
  ];
}

function tableQuery(table, hours, limit = 500, refreshSeconds = 60) {
  return [
    `SELECT * FROM ${table} WHERE timestamp >= NOW() - ${hours} hours ORDER BY timestamp DESC LIMIT ${limit}`,
    `SELECT * FROM ${table} WHERE insert_timestamp >= NOW() - ${hours} hours ORDER BY insert_timestamp DESC LIMIT ${limit}`,
    `SELECT * FROM ${table} ORDER BY timestamp DESC LIMIT ${limit}`,
    `SELECT * FROM ${table} ORDER BY insert_timestamp DESC LIMIT ${limit}`,
    `SELECT * FROM ${table} LIMIT ${limit}`
  ];
}

async function queryMonitoringTable(connectInfo, table, hours, limit, clientFilterCommand, refreshSeconds) {
  const { result, attempts } = await firstSuccessfulSql(
    connectInfo,
    MONITORING_DBMS,
    tableQuery(table, hours, limit, refreshSeconds),
    clientFilterCommand
  );
  return { rows: result?.rows || [], attempts };
}

function normalizePolicyRows(rows) {
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const nested = Object.values(row).find(value => value && typeof value === 'object' && !Array.isArray(value));
    return nested ? { ...nested, policy_type: Object.keys(row)[0] } : row;
  });
}

function normalizeIpPortRows(rows, company) {
  return rows.flatMap((row, index) => {
    if (!row) return [];
    if (typeof row === 'string' || typeof row === 'number') {
      const value = String(row);
      return [{
        id: value,
        name: value,
        ip_port: value,
        company,
        policy_type: 'operator'
      }];
    }
    if (typeof row !== 'object') return [];
    const ipPort = row.ip_port || row.ipPort || row['ip:port'] || row.address || row.node || row.name;
    const ip = row.ip || row.host || row.host_ip;
    const port = row.port || row.rest_port;
    const value = ipPort || (ip && port ? `${ip}:${port}` : '') || row.id || `operator-${index + 1}`;
    return [{
      ...row,
      id: row.id || value,
      name: row.name || row.operator || row.node_name || value,
      ip_port: value,
      company,
      policy_type: 'operator'
    }];
  });
}

function cleanCompany(value) {
  const text = String(value || '').trim();
  return /^(n\/a|na|none|null|unknown|-|—)$/i.test(text) ? '' : text;
}

function isErrorValue(value) {
  return /^(error executing command|backend error|failed to execute|server responded|httpconnectionpool|max retries exceeded)/i.test(String(value || '').trim());
}

function cleanMetadataName(value) {
  const text = String(value || '').trim();
  if (!text || isErrorValue(text)) return '';
  return text;
}

function sameCompany(left, right) {
  return cleanCompany(left).toLowerCase() === cleanCompany(right).toLowerCase();
}

function rowIpPorts(row) {
  if (!row || typeof row !== 'object') return [];
  return [
    row.ip_port,
    row.ipPort,
    row['ip:port'],
    row.address,
    row.Address,
    row.node,
    row.Node,
    row.name,
    row['node name'],
    row.node_name,
    embeddedIpPort(row.id),
    embeddedIpPort(row.name),
    embeddedIpPort(row.node),
    embeddedIpPort(row['node name']),
    embeddedIpPort(row.node_name),
    nodeNameBase(row.id),
    nodeNameBase(row.name),
    nodeNameBase(row.node),
    nodeNameBase(row['node name']),
    nodeNameBase(row.node_name)
  ].filter(Boolean).map(value => String(value).trim().toLowerCase());
}

function filterRowsByIpPorts(rows, allowedIpPorts) {
  if (!allowedIpPorts || allowedIpPorts.size === 0) return rows;
  return rows.filter(row => rowIpPorts(row).some(value => allowedIpPorts.has(value)));
}

function parseNetworkDatabaseRows(rows) {
  return rows
    .map(row => {
      if (!row || typeof row !== 'object') return null;
      return {
        company: cleanCompany(row.company || row.Company || row.publisher),
        dbms: cleanMetadataName(row.dbms || row.DBMS || row.name || row.database || row.Database)
      };
    })
    .filter(row => row?.dbms);
}

function parseTableRows(rows, fallback = {}) {
  const parsed = [];

  const addFlatRow = row => {
    if (!row || typeof row !== 'object') return;
    const dbms = cleanMetadataName(row.dbms || row.DBMS || row.database || row.Database || row.dbms_name || row.dbmsName || fallback.dbms);
    const table = cleanMetadataName(row.table || row.Table || row.name || row.table_name || row.tableName || row.table_id || row.tableId);
    if (!dbms || !table) return;
    parsed.push({
      dbms,
      table,
      company: cleanCompany(row.company || row.Company || fallback.company),
      nodes: Number(row.nodes || row.Nodes || row.replicas || row.members || 0) || 0,
      status: 'ok'
    });
  };

  rows.forEach(row => {
    addFlatRow(row);
    if (!row || typeof row !== 'object') return;
    Object.entries(row).forEach(([dbmsName, tables]) => {
      if (!tables || typeof tables !== 'object' || Array.isArray(tables)) return;
      Object.entries(tables).forEach(([tableName, value]) => {
        if (tableName === 'info' || tableName === 'type') return;
        const meta = value && typeof value === 'object' ? value : {};
        parsed.push({
          dbms: cleanMetadataName(dbmsName),
          table: cleanMetadataName(meta.table || meta.name || tableName),
          company: cleanCompany(meta.company || meta.Company || fallback.company),
          nodes: Number(meta.nodes || meta.members || meta.replicas || 0) || 0,
          status: 'ok'
        });
      });
    });
  });

  const unique = new Map();
  parsed
    .filter(row => row.dbms && row.table)
    .forEach(row => unique.set(`${row.dbms}.${row.table}`, row));
  return [...unique.values()];
}

export async function fetchEdgeDataFabricTopology(connectInfo, hours = 24, filters = {}) {
  if (!connectInfo) {
    return {
      sites: [],
      catalog: [],
      issues: [],
      apiLog: [],
      error: 'Select an AnyLog node to load topology data.'
    };
  }

  const apiLog = [];
  const tracked = async (label, promise) => {
    const result = await promise;
    asArray(result.attempts || result).forEach(entry => {
      if (!entry) return;
      apiLog.push({
        time: new Date().toLocaleTimeString(),
        kind: entry.ok === false ? 'ERR' : 'OK',
        detail: `${label}: ${entry.command}`,
        rows: entry.rowCount ?? entry.rows?.length ?? 0,
        duration: `${entry.durationMs ?? 0}ms`,
        error: entry.error
      });
    });
    return result;
  };

  const companyFilter = cleanCompany(filters.company);
  const refreshSeconds = Math.max(1, Number(filters.refreshSeconds) || 60);
  const monitoringClientFilter = operatorIpPortCommand(companyFilter);
  const [operatorsResult, operatorIpPortResult, queriesResult, mastersResult, publishersResult, dbsResult, monitoredOperatorsResult, syslogResult] = await Promise.all([
    tracked(
      companyFilter ? `metadata operators json company=${companyFilter}` : 'metadata operators',
      runAnyLog(connectInfo, operatorMetadataCommand(companyFilter))
    ),
    companyFilter
      ? tracked(
        `metadata operators ip_port company=${companyFilter}`,
        runAnyLog(connectInfo, operatorIpPortCommand(companyFilter))
      )
      : Promise.resolve({ rows: [] }),
    tracked('metadata queries', runAnyLog(connectInfo, policyMetadataCommand('query'))),
    tracked('metadata masters', runAnyLog(connectInfo, policyMetadataCommand('master'))),
    tracked('metadata publishers', runAnyLog(connectInfo, policyMetadataCommand('publisher'))),
    tracked('network databases', runAnyLog(connectInfo, 'get network databases')),
    tracked('monitored operators', runMonitoredOperators(connectInfo)),
    tracked('syslog', queryMonitoringTable(connectInfo, TABLES.syslog, hours, 300, monitoringClientFilter, refreshSeconds))
  ]);

  let operatorPolicies = normalizePolicyRows(operatorsResult.rows);
  if (companyFilter) {
    operatorPolicies = operatorPolicies.filter(row => sameCompany(row.company || row.Company, companyFilter));
    if (operatorPolicies.length === 0 && operatorIpPortResult?.rows?.length > 0) {
      operatorPolicies = normalizeIpPortRows(operatorIpPortResult.rows, companyFilter);
    }
  }
  const companyOperatorIpPorts = companyFilter
    ? new Set([
      ...operatorPolicies.flatMap(rowIpPorts),
      ...normalizeIpPortRows(operatorIpPortResult?.rows || [], companyFilter).flatMap(rowIpPorts)
    ])
    : new Set();
  const monitoredOperatorRows = companyFilter
    ? filterRowsByIpPorts(monitoredOperatorsResult.rows, companyOperatorIpPorts)
    : monitoredOperatorsResult.rows;
  const filterPoliciesByCompany = rows => (
    companyFilter
      ? rows.filter(row => sameCompany(row.company || row.Company || row.publisher, companyFilter))
      : rows
  );
  const queryPolicies = filterPoliciesByCompany(normalizePolicyRows(queriesResult.rows));
  const masterPolicies = filterPoliciesByCompany(normalizePolicyRows(mastersResult.rows));
  const publisherPolicies = filterPoliciesByCompany(normalizePolicyRows(publishersResult.rows));
  const networkDatabases = parseNetworkDatabaseRows(dbsResult.rows);
  const policyCompanies = [
    ...operatorPolicies,
    ...queryPolicies,
    ...masterPolicies,
    ...publisherPolicies
  ].map(row => cleanCompany(row.company || row.Company || row.publisher)).filter(Boolean);
  const networkCompanies = [...new Set([
    ...networkDatabases.map(item => item.company).filter(Boolean),
    ...policyCompanies
  ])];
  let scopedDatabases = companyFilter
    ? networkDatabases.filter(db => sameCompany(db.company, companyFilter))
    : networkDatabases;

  let catalog = [];
  if (companyFilter) {
    const [virtualTablesResult, companyDataNodesResult] = await Promise.all([
      tracked(
        `virtual tables company=${companyFilter}`,
        runAnyLog(connectInfo, virtualTablesCommand(companyFilter))
      ),
      tracked(
        `data nodes company=${companyFilter}`,
        runAnyLog(connectInfo, `get data nodes where format=json and company="${escapeAnyLogQuoted(companyFilter)}"`)
      )
    ]);
    const companyCatalog = [
      ...parseTableRows(virtualTablesResult.rows, { company: companyFilter }),
      ...parseTableRows(companyDataNodesResult.rows, { company: companyFilter })
    ];
    const uniqueCompanyCatalog = new Map();
    companyCatalog.forEach(item => {
      const key = `${cleanMetadataName(item.dbms).toLowerCase()}.${cleanMetadataName(item.table).toLowerCase()}`;
      if (key !== '.') uniqueCompanyCatalog.set(key, item);
    });
    catalog = [...uniqueCompanyCatalog.values()];

    const scopedDatabaseMap = new Map(
      scopedDatabases.map(item => [cleanMetadataName(item.dbms).toLowerCase(), item])
    );
    catalog.forEach(item => {
      const dbms = cleanMetadataName(item.dbms);
      if (!dbms) return;
      scopedDatabaseMap.set(dbms.toLowerCase(), {
        company: companyFilter,
        dbms
      });
    });
    scopedDatabases = [...scopedDatabaseMap.values()];
  } else {
    const tablesResult = await tracked(
      'network tables',
      runAnyLog(connectInfo, 'get tables where dbms=* and format=json')
    );
    catalog = parseTableRows(tablesResult.rows);
  }

  const catalogDbms = new Set(catalog.map(item => cleanMetadataName(item.dbms).toLowerCase()).filter(Boolean));
  const missingDatabases = scopedDatabases.filter(db => !catalogDbms.has(cleanMetadataName(db.dbms).toLowerCase()));
  if (missingDatabases.length > 0) {
    const tableLists = await Promise.all(missingDatabases.slice(0, 50).map(db =>
      tracked(
        `tables ${db.dbms}`,
        runAnyLog(connectInfo, `get tables where dbms="${escapeAnyLogQuoted(db.dbms)}" and format=json`)
      )
        .then(result => ({ result, db }))
    ));
    const fallbackCatalog = tableLists.flatMap(({ result, db }) => (
      parseTableRows(result.rows, { dbms: db.dbms, company: db.company })
    ));
    const mergedCatalog = new Map();
    [...catalog, ...fallbackCatalog].forEach(item => {
      const key = `${cleanMetadataName(item.dbms).toLowerCase()}.${cleanMetadataName(item.table).toLowerCase()}`;
      if (key !== '.') mergedCatalog.set(key, item);
    });
    catalog = [...mergedCatalog.values()];
  }

  return {
    operatorPolicies,
    queryPolicies,
    masterPolicies,
    publisherPolicies,
    networkDatabases,
    scopedNetworkDatabases: scopedDatabases,
    networkCompanies,
    activeCompanyFilter: companyFilter || '',
    catalog,
    monitorRows: monitoredOperatorRows,
    nodeRows: [],
    syslogRows: syslogResult.rows,
    apiLog,
    error: null
  };
}

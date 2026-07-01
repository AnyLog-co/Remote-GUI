// Creates a persistent state ( in Localstorage ) which handles vault information
// and connection information and states which are shared globally across multiple components

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { hiddenStorage } from '../storage/session';

/** Terminal ids in sidebar / panel order (ids may be absent from activeConnection). */
export const getOrderedTerminalIds = (state) => {
  const { activeConnection, activeTerminalOrder } = state;
  const order = activeTerminalOrder.filter((id) => activeConnection[id]);
  const missing = Object.keys(activeConnection).filter(
    (id) => !order.includes(id),
  );
  return [...order, ...missing];
};

export const cliState = create(
  persist(
    (set, get) => ({
      credLocked: true,
      secretsCache: {},
      modalView: null,
      activeConnection: {},
      activeTerminalOrder: [],
      connectionsList: [],
      focusedTerminalId: null,
      terminalLoading: false,
      terminalError: null,
      showAuthModal: false,

      setShowAuthModal: (state) => set({ showAuthModal: state }),

      setTerminalLoading: (state) => set({ terminalLoading: state }),

      setTerminalError: (err) => set({ terminalError: err }),

      setCredLocked: (lockedState) => set({ credLocked: lockedState }),

      cacheSecrets: (secrets) => set({ secretsCache: secrets }),

      clearSecretsCache: () => set({ secretsCache: {} }),

      setModalView: (name) => set({ modalView: name }),

      setFocusedTerminalId: (id) => set({ focusedTerminalId: id }),

      setConnectionsList: (connections) =>
        set({ connectionsList: connections }),

      addConnection: (connection) =>
        set((state) => ({
          connectionsList: [...state.connectionsList, connection],
        })),

      removeConnection: (id) =>
        set((state) => ({
          connectionsList: state.connectionsList.filter(
            (conn) => conn.id !== id,
          ),
        })),

      setActiveConnection: (id, conn) =>
        set((state) => ({
          activeConnection: {
            ...state.activeConnection,
            [id]: conn,
          },
          activeTerminalOrder: state.activeConnection[id]
            ? state.activeTerminalOrder
            : [...state.activeTerminalOrder, id],
        })),

      removeActiveConnection: (id) =>
        set((state) => {
          const updatedConnections = { ...state.activeConnection };
          delete updatedConnections[id];
          return {
            activeConnection: updatedConnections,
            activeTerminalOrder: state.activeTerminalOrder.filter(
              (terminalId) => terminalId !== id,
            ),
          };
        }),

      /** Reorder active terminals; `orderedIds` is the full list of connection ids in display order. */
      reorderActiveConnections: (orderedIds) =>
        set((state) => ({
          activeTerminalOrder: orderedIds.filter(
            (id) => state.activeConnection[id],
          ),
        })),

      setIsConnected: (id, connState) =>
        set((state) => {
          const connection = state.activeConnection[id];
          if (!connection) return state;
          return {
            activeConnection: {
              ...state.activeConnection,
              [id]: { ...connection, isConnected: connState },
            },
          };
        }),

      lockSession: () => {
        set({
          credLocked: true,
          secretsCache: {},
          activeConnection: {},
          activeTerminalOrder: [],
          modalView: null,
        });
        sessionStorage.removeItem('cli-session-state');
      },
    }),
    {
      name: 'cli-session-state',
      storage: createJSONStorage(() => hiddenStorage),

      partialize: (state) => ({
        credLocked: state.credLocked,
        activeTerminalOrder: state.activeTerminalOrder,
        activeConnection: Object.fromEntries(
          Object.entries(state.activeConnection).map(([id, conn]) => {
            const { credential, ...persistedConnection } = conn;
            return [
              id,
              {
                ...persistedConnection,
                isConnected: false,
              },
            ];
          }),
        ),
      }),
    },
  ),
);

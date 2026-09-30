import { createContext, useContext } from 'react';

// Conta logada e ação de sair, disponíveis para as telas (ex.: botão "Sair" no perfil)
export const SessionContext = createContext({ user: null, signOut: async () => {} });

export const useSession = () => useContext(SessionContext);

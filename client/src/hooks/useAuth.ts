import { createContext, useContext } from 'react';
import { User } from '../types';

export interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  setUser: () => {},
});

export const useAuth = () => useContext(AuthContext);

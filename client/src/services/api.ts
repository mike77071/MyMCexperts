import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  withCredentials: true, // required to send/receive httpOnly cookies
  headers: { 'Content-Type': 'application/json' },
});

// Redirect to login on 401 (expired/invalid session)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (email: string, password: string) =>
  api.post('/auth/login', { email, password });

export const logout = () => api.post('/auth/logout');

export const getMe = () => api.get('/auth/me');

// ── Users ─────────────────────────────────────────────────────────────────────
export const getUsers = () => api.get('/users');

export const createUser = (data: {
  email: string;
  password: string;
  name: string;
  role: string;
}) => api.post('/users', data);

export const updateUser = (id: string, data: { name?: string; role?: string; password?: string; isActive?: boolean }) =>
  api.put(`/users/${id}`, data);

export const deleteUser = (id: string) => api.delete(`/users/${id}`);

export const assignFacilities = (userId: string, facilityIds: string[]) =>
  api.patch(`/users/${userId}/facilities`, { facilityIds });

// ── Facilities ────────────────────────────────────────────────────────────────
export const getFacilities = () => api.get('/facilities');

export const getFacility = (id: string) => api.get(`/facilities/${id}`);

export const createFacility = (data: {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  npi?: string;
  phone?: string;
}) => api.post('/facilities', data);

export const updateFacility = (id: string, data: object) => api.put(`/facilities/${id}`, data);

export const deleteFacility = (id: string) => api.delete(`/facilities/${id}`);

// ── Contracts ─────────────────────────────────────────────────────────────────
export const getContracts = () => api.get('/contracts');

export const uploadContract = (
  facilityId: string,
  formData: FormData
) =>
  api.post(`/contracts/facilities/${facilityId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

export const getContractMatrix = (contractId: string) =>
  api.get(`/contracts/${contractId}/matrix`);

export const getExportUrl = (contractId: string) =>
  `${import.meta.env.VITE_API_URL ?? '/api'}/contracts/${contractId}/export`;

export const deleteContract = (contractId: string) =>
  api.delete(`/contracts/${contractId}`);

// ── Dashboard ──────────────────────────────────────────────────────────────────
export const getDashboard = () => api.get('/dashboard');

export default api;

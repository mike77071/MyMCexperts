import { useState, useEffect, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from './hooks/useAuth';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { Navbar } from './components/layout/Navbar';
import { LoginPage } from './pages/LoginPage';
import { FacilitiesPage } from './pages/FacilitiesPage';
import { FacilityDetailPage } from './pages/FacilityDetailPage';
import { UploadContractPage } from './pages/UploadContractPage';
import { BatchUploadPage } from './pages/BatchUploadPage';
import { MatrixPage } from './pages/MatrixPage';
import { AdminPage } from './pages/AdminPage';
import { ContractsPage } from './pages/ContractsPage';
import { DashboardPage } from './pages/DashboardPage';
import { getMe } from './services/api';
import { User } from './types';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then((res) => setUser(res.data.user))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user, isLoading, setUser }}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<ProtectedRoute />}>
              <Route
                path="/dashboard"
                element={
                  <AppLayout>
                    <DashboardPage />
                  </AppLayout>
                }
              />
              <Route
                path="/facilities"
                element={
                  <AppLayout>
                    <FacilitiesPage />
                  </AppLayout>
                }
              />
              <Route
                path="/facilities/:id"
                element={
                  <AppLayout>
                    <FacilityDetailPage />
                  </AppLayout>
                }
              />
              <Route
                path="/facilities/:facilityId/contracts/upload"
                element={
                  <AppLayout>
                    <UploadContractPage />
                  </AppLayout>
                }
              />
              <Route
                path="/facilities/:facilityId/contracts/batch-upload"
                element={
                  <AppLayout>
                    <BatchUploadPage />
                  </AppLayout>
                }
              />
              <Route
                path="/contracts"
                element={
                  <AppLayout>
                    <ContractsPage />
                  </AppLayout>
                }
              />
              <Route
                path="/contracts/:contractId/matrix"
                element={
                  <AppLayout>
                    <MatrixPage />
                  </AppLayout>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={['ADMIN']} />
                }
              >
                <Route
                  index
                  element={
                    <AppLayout>
                      <AdminPage />
                    </AppLayout>
                  }
                />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

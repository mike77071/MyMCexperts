import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { logout } from '../../services/api';

export function Navbar() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    setUser(null);
    navigate('/login');
  };

  return (
    <nav className="bg-brand-900 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link to="/dashboard" className="font-bold text-lg tracking-tight">
              My MC Experts
            </Link>
            <div className="hidden sm:flex gap-6 text-sm">
              <Link to="/dashboard" className="hover:text-brand-100 transition-colors">
                Dashboard
              </Link>
              <Link to="/contracts" className="hover:text-brand-100 transition-colors">
                Contracts
              </Link>
              <Link to="/facilities" className="hover:text-brand-100 transition-colors">
                Facilities
              </Link>
              {user?.role === 'ADMIN' && (
                <Link to="/admin" className="hover:text-brand-100 transition-colors">
                  Users
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-brand-100 hidden sm:block">{user?.name}</span>
            <span className="text-xs bg-brand-700 px-2 py-0.5 rounded uppercase tracking-wide">
              {user?.role?.replace('_', ' ')}
            </span>
            <button
              onClick={handleLogout}
              className="text-brand-100 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}

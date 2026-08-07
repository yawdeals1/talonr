import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { RequireAdmin, RequireAuth } from "./components/RequireAuth";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { AdminAccountsJobs } from "./pages/admin/AdminAccountsJobs";
import { AdminActivity } from "./pages/admin/AdminActivity";
import { AdminUsers } from "./pages/admin/AdminUsers";
import { Dashboard } from "./pages/Dashboard";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { LeadListDetail } from "./pages/LeadListDetail";
import { LeadListForm } from "./pages/LeadListForm";
import { LeadLists } from "./pages/LeadLists";
import { LeadsBrowser } from "./pages/LeadsBrowser";
import { LoginRegister } from "./pages/LoginRegister";
import { ScrapeJobDetail } from "./pages/ScrapeJobDetail";
import { ScrapeJobs } from "./pages/ScrapeJobs";
import { TriggerScrape } from "./pages/TriggerScrape";
import { XAccounts } from "./pages/XAccounts";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginRegister />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route index element={<Dashboard />} />
                  <Route path="accounts" element={<XAccounts />} />
                  <Route path="scrapes" element={<ScrapeJobs />} />
                  <Route path="scrapes/new" element={<TriggerScrape />} />
                  <Route path="scrapes/:id" element={<ScrapeJobDetail />} />
                  <Route path="leads" element={<LeadsBrowser />} />
                  <Route path="lead-lists" element={<LeadLists />} />
                  <Route path="lead-lists/new" element={<LeadListForm />} />
                  <Route path="lead-lists/:id" element={<LeadListDetail />} />
                  <Route path="lead-lists/:id/edit" element={<LeadListForm />} />

                  <Route element={<RequireAdmin />}>
                    <Route path="admin/users" element={<AdminUsers />} />
                    <Route path="admin/accounts-jobs" element={<AdminAccountsJobs />} />
                    <Route path="admin/activity" element={<AdminActivity />} />
                  </Route>
                </Route>
              </Route>
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

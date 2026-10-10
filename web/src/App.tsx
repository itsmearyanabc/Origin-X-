import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { Spinner } from "@/components/ui";
import { RequireAdmin, RequireAuth, RequireOrgMember } from "@/components/guards";

const MarketingLayout = lazy(() => import("@/marketing/MarketingLayout"));
const Landing = lazy(() => import("@/marketing/Landing"));
const FeaturesPage = lazy(() => import("@/marketing/pages/FeaturesPage"));
const HowItWorksPage = lazy(() => import("@/marketing/pages/HowItWorksPage"));
const WhyPage = lazy(() => import("@/marketing/pages/WhyPage"));
const PricingPage = lazy(() => import("@/marketing/pages/PricingPage"));
const SecurityPage = lazy(() => import("@/marketing/pages/SecurityPage"));
const ContactPage = lazy(() => import("@/marketing/pages/ContactPage"));
const LegalPage = lazy(() => import("@/marketing/pages/LegalPage"));
const NotFound = lazy(() => import("@/marketing/pages/NotFound"));

const AuthLayout = lazy(() => import("@/auth/AuthLayout"));
const SignIn = lazy(() => import("@/auth/SignIn"));
const SignUp = lazy(() => import("@/auth/SignUp"));
const ForgotPassword = lazy(() => import("@/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("@/auth/ResetPassword"));
const AcceptInvite = lazy(() => import("@/auth/AcceptInvite"));
const VerifyEmail = lazy(() => import("@/auth/VerifyEmail"));
const Onboarding = lazy(() => import("@/auth/Onboarding"));

const VerifyHome = lazy(() => import("@/verify/VerifyHome"));
const VerifyResult = lazy(() => import("@/verify/VerifyResult"));

const AppLayout = lazy(() => import("@/app/AppLayout"));
const AppDashboard = lazy(() => import("@/app/pages/Dashboard"));
const Products = lazy(() => import("@/app/pages/Products"));
const ProductDetail = lazy(() => import("@/app/pages/ProductDetail"));
const Batches = lazy(() => import("@/app/pages/Batches"));
const Custody = lazy(() => import("@/app/pages/Custody"));
const Partners = lazy(() => import("@/app/pages/Partners"));
const Incidents = lazy(() => import("@/app/pages/Incidents"));
const Recalls = lazy(() => import("@/app/pages/Recalls"));
const Verification = lazy(() => import("@/app/pages/Verification"));
const Team = lazy(() => import("@/app/pages/Team"));
const Settings = lazy(() => import("@/app/pages/Settings"));
const AuditLog = lazy(() => import("@/app/pages/AuditLog"));
const InventoryOverview = lazy(() => import("@/app/inventory/InventoryOverview"));
const ProductInventory = lazy(() => import("@/app/inventory/ProductInventory"));
const SkuDetail = lazy(() => import("@/app/inventory/ProductInventory").then((m) => ({ default: m.SkuDetail })));
const Movements = lazy(() => import("@/app/inventory/Movements"));
const Warehouses = lazy(() => import("@/app/inventory/Warehouses"));
const WarehouseDetail = lazy(() => import("@/app/inventory/Warehouses").then((m) => ({ default: m.WarehouseDetail })));
const Shipments = lazy(() => import("@/app/inventory/Shipments"));
const NewShipment = lazy(() => import("@/app/inventory/Shipments").then((m) => ({ default: m.NewShipment })));
const ShipmentDetail = lazy(() => import("@/app/inventory/Shipments").then((m) => ({ default: m.ShipmentDetail })));

const AdminLayout = lazy(() => import("@/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("@/admin/pages/AdminDashboard"));
const AdminOrganizations = lazy(() => import("@/admin/pages/AdminOrganizations"));
const AdminOrganization = lazy(() => import("@/admin/pages/AdminOrganization"));
const AdminUsers = lazy(() => import("@/admin/pages/AdminUsers"));
const AdminProducts = lazy(() => import("@/admin/pages/AdminProducts"));
const AdminIncidents = lazy(() => import("@/admin/pages/AdminIncidents"));
const AdminRecalls = lazy(() => import("@/admin/pages/AdminRecalls"));
const AdminBlockchain = lazy(() => import("@/admin/pages/AdminBlockchain"));
const AdminVerifications = lazy(() => import("@/admin/pages/AdminVerifications"));
const AdminAudit = lazy(() => import("@/admin/pages/AdminAudit"));
const AdminMessages = lazy(() => import("@/admin/pages/AdminMessages"));
const AdminSettings = lazy(() => import("@/admin/pages/AdminSettings"));

function PageFallback() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <ScrollToTop />
      <Routes>
        {/* Public website */}
        <Route index element={<Landing />} />
        <Route element={<MarketingLayout />}>
          <Route path="features" element={<FeaturesPage />} />
          <Route path="how-it-works" element={<HowItWorksPage />} />
          <Route path="why-originx" element={<WhyPage />} />
          <Route path="pricing" element={<PricingPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="privacy" element={<LegalPage doc="privacy" />} />
          <Route path="terms" element={<LegalPage doc="terms" />} />
          <Route path="cookies" element={<LegalPage doc="cookies" />} />
        </Route>

        {/* Consumer verification — no account */}
        <Route path="verify" element={<VerifyHome />} />
        <Route path="verify/:token" element={<VerifyResult />} />

        {/* Accounts */}
        <Route element={<AuthLayout />}>
          <Route path="sign-in" element={<SignIn />} />
          <Route path="sign-up" element={<SignUp />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />
          <Route path="verify-email" element={<VerifyEmail />} />
          <Route path="invite" element={<AcceptInvite />} />
          <Route
            path="onboarding"
            element={
              <RequireAuth>
                <Onboarding />
              </RequireAuth>
            }
          />
        </Route>

        {/* Organization panel */}
        <Route
          path="app"
          element={
            <RequireOrgMember>
              <AppLayout />
            </RequireOrgMember>
          }
        >
          <Route index element={<AppDashboard />} />
          <Route path="products" element={<Products />} />
          <Route path="products/:productId" element={<ProductDetail />} />
          <Route path="batches" element={<Batches />} />
          <Route path="custody" element={<Custody />} />
          <Route path="partners" element={<Partners />} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="recalls" element={<Recalls />} />
          <Route path="verification" element={<Verification />} />
          <Route path="team" element={<Team />} />
          <Route path="settings" element={<Settings />} />
          <Route path="audit" element={<AuditLog />} />
          <Route path="inventory" element={<InventoryOverview />} />
          <Route path="inventory/products" element={<ProductInventory />} />
          <Route path="inventory/products/:skuId" element={<SkuDetail />} />
          <Route path="inventory/movements" element={<Movements />} />
          <Route path="warehouses" element={<Warehouses />} />
          <Route path="warehouses/:warehouseId" element={<WarehouseDetail />} />
          <Route path="shipments" element={<Shipments />} />
          <Route path="shipments/new" element={<NewShipment />} />
          <Route path="shipments/:shipmentId" element={<ShipmentDetail />} />
        </Route>

        {/* ORIGINX platform administration */}
        <Route
          path="admin"
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="organizations" element={<AdminOrganizations />} />
          <Route path="organizations/:id" element={<AdminOrganization />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="incidents" element={<AdminIncidents />} />
          <Route path="recalls" element={<AdminRecalls />} />
          <Route path="blockchain" element={<AdminBlockchain />} />
          <Route path="verifications" element={<AdminVerifications />} />
          <Route path="audit" element={<AdminAudit />} />
          <Route path="messages" element={<AdminMessages />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>

        <Route path="dashboard" element={<Navigate to="/app" replace />} />
        <Route element={<MarketingLayout />}>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

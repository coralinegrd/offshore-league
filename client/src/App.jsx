import { useEffect, useState } from "react";
import AdminPage from "./pages/AdminPage.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import CheckoutPage from "./pages/CheckoutPage.jsx";
import ChallengePage from "./pages/ChallengePage.jsx";
import ChallengesPage from "./pages/ChallengesPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import LeaderboardPage from "./pages/LeaderboardPage.jsx";
import PrivacyPage from "./pages/PrivacyPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import SubmissionPage from "./pages/SubmissionPage.jsx";
import SuccessPage from "./pages/SuccessPage.jsx";
import TermsPage from "./pages/TermsPage.jsx";
import BottomNav from "./components/BottomNav.jsx";
import Footer from "./components/Footer.jsx";
import Nav from "./components/Nav.jsx";
import { loadAuth } from "./authStorage.js";

function getRoute() {
  return window.location.pathname || "/";
}

export default function App() {
  const [route, setRoute] = useState(getRoute());
  const [auth, setAuth] = useState(loadAuth());

  useEffect(() => {
    const onPopState = () => setRoute(getRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (path) => {
    window.history.pushState({}, "", path);
    setRoute(getRoute());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  let page = <ChallengePage auth={auth} navigate={navigate} />;

  if (route === "/challenges") page = <ChallengesPage navigate={navigate} />;
  if (route === "/dashboard") page = <DashboardPage auth={auth} navigate={navigate} onAuth={setAuth} />;
  if (route === "/auth" || route === "/auth/callback") page = <AuthPage navigate={navigate} onAuth={setAuth} />;
  if (route === "/checkout") page = <CheckoutPage auth={auth} navigate={navigate} />;
  if (route === "/success") page = <SuccessPage navigate={navigate} />;
  if (route === "/submit") page = <SubmissionPage navigate={navigate} />;
  if (route === "/leaderboard") page = <LeaderboardPage />;
  if (route === "/admin") page = <AdminPage auth={auth} navigate={navigate} />;
  if (route === "/terms") page = <TermsPage navigate={navigate} />;
  if (route === "/privacy") page = <PrivacyPage navigate={navigate} />;
  if (route === "/profile") page = <ProfilePage auth={auth} navigate={navigate} onAuth={setAuth} />;

  return (
    <>
      <Nav auth={auth} navigate={navigate} route={route} />
      {page}
      <BottomNav navigate={navigate} route={route} />
      <Footer navigate={navigate} />
    </>
  );
}

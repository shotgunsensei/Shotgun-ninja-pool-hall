import type { JSX } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import MainMenu from "@/pages/MainMenu";
import Practice from "@/pages/Practice";
import LocalTwoPlayer from "@/pages/LocalTwoPlayer";
import HostGame from "@/pages/HostGame";
import JoinGame from "@/pages/JoinGame";
import SettingsPage from "@/pages/Settings";
import NotFound from "@/pages/not-found";

function Router(): JSX.Element {
  return (
    <Switch>
      <Route path="/" component={MainMenu} />
      <Route path="/practice" component={Practice} />
      <Route path="/local" component={LocalTwoPlayer} />
      <Route path="/host" component={HostGame} />
      <Route path="/join" component={JoinGame} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App(): JSX.Element {
  return (
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;

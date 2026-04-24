import type { JSX } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Bot, Users, Wifi, Settings as SettingsIcon, Github } from "lucide-react";

interface MenuItem {
  to: string;
  title: string;
  desc: string;
  icon: JSX.Element;
  testId: string;
}

const ITEMS: MenuItem[] = [
  {
    to: "/practice",
    title: "Practice",
    desc: "Play against a basic CPU opponent",
    icon: <Bot className="h-7 w-7" aria-hidden="true" />,
    testId: "menu-practice",
  },
  {
    to: "/local",
    title: "Local 2-player",
    desc: "Pass the phone, hot-seat",
    icon: <Users className="h-7 w-7" aria-hidden="true" />,
    testId: "menu-local",
  },
  {
    to: "/host",
    title: "Host online room",
    desc: "Get a code and share with a friend",
    icon: <Wifi className="h-7 w-7" aria-hidden="true" />,
    testId: "menu-host",
  },
  {
    to: "/join",
    title: "Join online room",
    desc: "Type a 4-letter code",
    icon: <Wifi className="h-7 w-7 rotate-180" aria-hidden="true" />,
    testId: "menu-join",
  },
  {
    to: "/settings",
    title: "Settings",
    desc: "Aim guide, table speed, sound, vibration",
    icon: <SettingsIcon className="h-7 w-7" aria-hidden="true" />,
    testId: "menu-settings",
  },
];

export default function MainMenu(): JSX.Element {
  return (
    <div className="min-h-screen w-full flex flex-col">
      <header className="px-5 pt-8 pb-4 text-center">
        <div className="mx-auto w-16 h-16 mb-3 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary text-2xl font-black">
          8
        </div>
        <h1 className="text-3xl font-bold tracking-tight">LAN Pool Lite</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A clean 8-ball pool game. No ads, no login, no coins.
        </p>
      </header>

      <main className="flex-1 px-4 pb-6 max-w-md w-full mx-auto flex flex-col gap-3">
        {ITEMS.map((item) => (
          <Link key={item.to} href={item.to}>
            <Card
              className="cursor-pointer hover-elevate active-elevate-2"
              data-testid={item.testId}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="text-primary shrink-0">{item.icon}</div>
                <div className="min-w-0">
                  <div className="font-semibold">{item.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{item.desc}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </main>

      <footer className="px-4 pb-6 text-center text-[11px] text-muted-foreground">
        <div className="flex items-center justify-center gap-1.5">
          <Github className="h-3 w-3" aria-hidden="true" />
          <span>Single-page web app · installable to home screen</span>
        </div>
      </footer>
    </div>
  );
}

/**
 * Makerspace dashboard wrapper. Navigation (makerspace switcher, team,
 * settings, public page) now lives in the app shell sidebar, so this only
 * keeps a consistent vertical rhythm for the page content.
 */
export function DashboardLayout(props: {
  makerspaceName: string;
  makerspaceSlug: string;
  children: React.ReactNode;
}) {
  return <div className="flex flex-col gap-6">{props.children}</div>;
}

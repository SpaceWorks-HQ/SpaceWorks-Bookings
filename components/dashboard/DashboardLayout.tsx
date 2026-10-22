/**
 * Organisation dashboard wrapper. Navigation (organisation switcher, team,
 * settings, public page) now lives in the app shell sidebar, so this only
 * keeps a consistent vertical rhythm for the page content.
 */
export function DashboardLayout(props: {
  organisationName: string;
  organisationSlug: string;
  children: React.ReactNode;
}) {
  return <div className="flex flex-col gap-6">{props.children}</div>;
}

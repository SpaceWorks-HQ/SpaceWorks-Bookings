import { BrandPageLoader } from "@/components/brand/BrandLoader";

// Deliberately not at app/loading.tsx: a root Suspense boundary makes public
// pages stream a 200 before notFound()/redirect() run, which breaks real 404s.
export default function Loading() {
  return <BrandPageLoader />;
}

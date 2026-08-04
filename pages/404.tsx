import Link from "next/link";

export default function Custom404() {
  return (
    <div style={{ padding: "50px", textAlign: "center", background: "#020617", color: "#f8fafc", minHeight: "100vh" }}>
      <h1>404 - Page Not Found</h1>
      <p style={{ margin: "20px 0", color: "#94a3b8" }}>The page you are looking for does not exist.</p>
      <Link href="/" style={{ color: "#f59e0b", textDecoration: "underline" }}>
        Return to Home
      </Link>
    </div>
  );
}

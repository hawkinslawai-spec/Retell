import LoginClient from "./login-client";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginClient brand={process.env.BRAND_NAME || "Hawkins Law"} />;
}

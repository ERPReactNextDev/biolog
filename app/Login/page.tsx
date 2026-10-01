import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    /* No padding here: the form's gradient should be full-bleed edge to edge,
       and LoginForm owns its own inner spacing. The py-* that used to sit on
       this wrapper also pushed the child past 100svh, which forced a scrollbar
       and clipped the footer. */
    <div
      className="mint-ui mint-scope flex min-h-svh flex-col"
      style={{ background: "var(--bg)" }}
    >
      {/* Full width below lg — a max-w-sm here clamped the whole form to 384px
          and left large empty margins on tablet-sized viewports. */}
      <div className="w-full flex-1 lg:max-w-4xl mx-auto">
        <LoginForm />
      </div>
    </div>
  );
}

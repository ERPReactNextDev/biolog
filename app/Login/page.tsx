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
      {/* FULL WIDTH, deliberately. There is no max-width cap here.

          The earlier lg:max-w-6xl left visible gutters either side of the
          split on a desktop monitor, which read as the page not filling the
          screen. The two panels now run edge to edge, as a login screen
          should.

          Because the panels are now as wide as the monitor, the CONTENT
          inside them carries its own measure rather than relying on a narrow
          wrapper to provide one — see the max-w on the branding column and the
          max-w-sm form. Without that, a 2560px display would stretch a 40px
          headline across a metre of space and the form would drift off into
          the middle of a very wide column. */}
      <div className="w-full flex-1">
        <LoginForm />
      </div>
    </div>
  );
}

const macAppHref = "https://github.com/2050-to/observer.to-sigint";
const macDownloadHref = "/release/Observer.to.dmg";

const steps = [
  "Download the Mac app, or get it from the GitHub repository when the download is not published yet.",
  "Sign in with a magic link. You can sign in here or in the Mac app.",
  "Start a drive on the Mac. It records Wi-Fi networks, public Bluetooth advertisements, and its own GPS, altitude, and speed. It does not connect to Bluetooth devices.",
  "Sign in on this site to review what the Mac has uploaded: range, a map, open networks, and a log.",
];

export default function Page() {
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Legal purple team</p>
          <h1>Observer.to</h1>
        </div>
        <div className="header-actions">
          <a className="button" href="/app">Sign in</a>
          <a className="button" href={macDownloadHref}>Download for Mac</a>
          <a className="button" href={macAppHref}>
            Mac app on GitHub
          </a>
        </div>
      </header>

      <p className="lede">
        Observer.to records the wireless presence around a place you are responsible for. It is a purple-team observer: the same evidence for the people who defend a site and the people who test it. It records public beacons. It does not join networks or record anyone else's traffic. The Mac app captures Wi-Fi, Bluetooth, and GPS. This site is where you sign in and review what that Mac has already uploaded.
      </p>

      <section id="how-it-works" aria-labelledby="how-heading">
        <h2 id="how-heading">How it works</h2>
        <ol className="steps">
          {steps.map((step, index) => (
            <li key={step}>
              <span className="step-index">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section id="review" aria-labelledby="review-heading">
        <h2 id="review-heading">What you can review</h2>
        <ul>
          <li>Range, a map, open networks, and a log of the public beacons the drive heard.</li>
          <li>
            An owned-network check lists addresses and announced names on a network you own, and what changed since the previous inventory. It does not open video, try passwords, or record traffic.
          </li>
          <li>
            Enrichment ties observed Wi-Fi and Bluetooth names to public support pages, vendor advisories, CVE and NVD records, and CISA KEV. It prepares vendor-supported remediation guidance and does not download exploit code.
          </li>
          <li>
            A passive scan does not reveal installed firmware. Recording the model and firmware replaces the potentially applicable line. High risk stays in the review until the disposition is closed.
          </li>
          <li>
            The Mac app shows a checklist of security settings on that Mac. One button applies the stricter listed settings, then the app reports which settings are now more secure. The report stays on that Mac.
          </li>
          <li>
            Mac Processes lists the processes on that Mac, keeps the rare ones at the top of the catalog, and notifies you when a process is outside the allowlist and the baseline. The catalog stays on that Mac.
          </li>
        </ul>
      </section>

      <section className="price" aria-label="Plans">
        <article id="download">
          <h2>Free</h2>
          <p>
            The Mac app is free. Sign in and use the observer: drives, range, map, open networks, log, enrichment, exports, sites, the Changes tab, the owned-network check, the This Mac checklist, and Mac Processes.
          </p>
          <a className="button" href={macDownloadHref}>Download for Mac</a>
          <a className="button" href={macAppHref}>
            Mac app on GitHub
          </a>
        </article>
        <article id="subscribe">
          <h2>$5 per month</h2>
          <p>
            One email each week laying out the same review shown on the Changes tab: open networks, high-risk public research, site findings, owned-network changes, and what is new since the last review. The same subscription sends an immediate email when a claimed network is heard as open or WEP, on a BSSID you did not claim, or on a different channel. It also lets you ask questions about your own records. The Android app notifies the phone that uploaded a scan when that scan opens an evil twin.
          </p>
          <p>Subscribe from this site or from the Mac app after you sign in.</p>
        </article>
      </section>

      <section id="limits" aria-labelledby="limits-heading">
        <h2 id="limits-heading">What it will not do</h2>
        <ul>
          <li>It does not intercept protected Wi-Fi, active Bluetooth connections, or cellular calls and messages.</li>
          <li>It does not capture subscriber identities such as IMSI or TMSI.</li>
          <li>It does not transmit, jam, or spoof.</li>
          <li>It does not track a person from a hardware address.</li>
          <li>Search and questions stay inside the signed-in account.</li>
          <li>Sign in with your email. The first time, you accept the Terms of Service and the Privacy Policy and confirm you are 18 or older. Later sign-ins remind you that signing in agrees to them.</li>
          <li>The This Mac checklist does not upload those settings, does not change another computer, and does not turn off Wi-Fi or Bluetooth.</li>
          <li>Mac Processes does not upload the process catalog, does not save command lines, and does not stop processes.</li>
        </ul>
      </section>
      <p className="note">
        <a href="/terms">Terms of Service</a>
        {" · "}
        <a href="/privacy">Privacy Policy</a>
      </p>
    </main>
  );
}

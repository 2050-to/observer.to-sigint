const downloadHref = "/release/Observer.to.dmg";

const steps = [
  "Download the free Mac app and drag Observer.to to Applications.",
  "Sign in with a magic link. You can sign in here or in the Mac app.",
  "Start a drive on the Mac. It records Wi-Fi networks, public Bluetooth advertisements, and its own GPS, altitude, and speed. It does not connect to Bluetooth devices. Import search history and browsing history from that Mac when you want them saved.",
  "Sign in on this site to review what the Mac has uploaded: range, a map, open networks, a log, search history, and browsing history.",
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
          <a className="button" href={downloadHref}>
            Download free for Mac
          </a>
        </div>
      </header>

      <p className="lede">
        Observer.to records the wireless presence around a place you are responsible for. It is a purple-team observer: the same evidence for the people who defend a site and the people who test it. It records public beacons. It does not join networks or record anyone else's traffic. The Mac app captures Wi-Fi, Bluetooth, GPS, search history, and browsing history. This site is where you sign in and review what that Mac has already uploaded.
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
            An owned-network check lists addresses and announced names on a network you own. It does not open video, try passwords, or record traffic.
          </li>
          <li>
            Enrichment ties observed Wi-Fi and Bluetooth names to public support pages, vendor advisories, CVE and NVD records, and CISA KEV. It prepares vendor-supported remediation guidance and does not download exploit code.
          </li>
          <li>
            A passive scan does not reveal installed firmware. Findings stay labeled as potentially applicable until the exact model and installed version are verified.
          </li>
        </ul>
      </section>

      <section className="price" aria-label="Plans">
        <article id="download">
          <h2>Free</h2>
          <p>
            The Mac app is free to download. Sign in and use the observer: drives, range, map, open networks, log, enrichment, exports, and the owned-network check.
          </p>
          <a className="button" href={downloadHref}>
            Download Observer.to.dmg
          </a>
          <p className="note">
            The disk image is not notarized. On another Mac, Control-click the app and choose Open.
          </p>
        </article>
        <article id="subscribe">
          <h2>$5 per month</h2>
          <p>
            One email each week laying out vulnerabilities and patch guidance for the local Wi-Fi and Bluetooth devices in your saved catalog. The review covers open networks, high-risk public research, and what is new since the last review. The same subscription lets you ask questions about your own Wi-Fi places, search history, and browsing history.
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
          <li>The observer and stored data open only after you read and accept the current Terms and Privacy Policy. You must be 18 or older.</li>
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

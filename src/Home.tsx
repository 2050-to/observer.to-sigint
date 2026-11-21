import { AccountBar, useAccount } from './AccountBar'

export function Home() {
  const account = useAccount()
  return (
    <main className="home">
      <header>
        <div>
          <p className="eyebrow">Legal purple team</p>
          <h1>Observer.to</h1>
        </div>
        {account && <AccountBar account={account} />}
      </header>
      <p className="lede">
        Observer.to records the wireless presence around a place you are responsible for. It is a purple-team observer: the same evidence for the people who defend a site and the people who test it, collected without joining networks or capturing traffic.
      </p>
      <section>
        <h2>What goes missing</h2>
        <ul>
          <li>A floor inventory misses what a phone can actually hear. Neighboring open Wi-Fi, guest radios, and Bluetooth advertisers show up only while you walk the site.</li>
          <li>Listing those networks by joining them or capturing traffic is the wrong tool, and often unlawful. Observer.to records public beacons only.</li>
          <li>A device name does not say whether the product is still supported or listed in public advisories and CISA KEV. Enrichment ties that public research to names you observed. It does not download exploit code.</li>
          <li>Cameras and recorders on a network you own are easy to miss. The owned-network check lists addresses and announced names. It does not open video, try passwords, or record traffic.</li>
          <li>Purple-team evidence goes stale. The paid plan emails one review a week.</li>
        </ul>
      </section>
      <section>
        <h2>What it will not do</h2>
        <ul>
          <li>It does not intercept protected Wi-Fi, active Bluetooth connections, or cellular calls and messages.</li>
          <li>It does not capture subscriber identities such as IMSI or TMSI.</li>
          <li>It does not transmit, jam, or spoof.</li>
          <li>It does not track a person from a hardware address.</li>
        </ul>
      </section>
      <section className="price">
        <article>
          <h2>Free</h2>
          <p>Sign in and use the observer: drives, range, map, open networks, log, enrichment, exports, and the owned-network check.</p>
        </article>
        <article>
          <h2>$5 per month</h2>
          <p>One purple-team alert email each week. Open networks, high-risk public research, and what is new since the last review.</p>
        </article>
      </section>
      <section>
        <h2>Your observer</h2>
        <p><a href="/app">Open the observer</a></p>
      </section>
    </main>
  )
}

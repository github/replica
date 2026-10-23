import "./styles.css"

const trails = [
  {
    index: "01",
    name: "The ridge path",
    region: "NORTH COAST",
    distance: "8.4 KM",
    className: "ridge",
  },
  {
    index: "02",
    name: "Fern & fallen light",
    region: "OLD GROWTH",
    distance: "4.2 KM",
    className: "fern",
  },
  {
    index: "03",
    name: "A way to the water",
    region: "LOWLANDS",
    distance: "11 KM",
    className: "water",
  },
]

export function HomePage() {
  return (
    <div className="field-page" id="top">
      <header className="field-nav">
        <a className="field-mark" href="#top">
          <span aria-hidden="true">✳</span> FIELDWORK
        </a>
        <span>AN ATLAS OF SMALL ADVENTURES</span>
        <a href="#routes">
          THE ROUTES <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main>
        <section className="field-hero">
          <div className="field-hero-copy">
            <div className="field-coordinate">VOL. 04 · 54° 02′ N / 02° 48′ W</div>
            <h1>
              Go where
              <br />
              the <em>day</em>
              <br />
              takes you.
            </h1>
            <p>
              Hand-drawn routes, quiet places, and good reasons to take the long way round. The
              outdoors is closer than you think.
            </p>
            <a href="#routes" className="field-button">
              FIND YOUR NEXT WALK <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div
            className="field-landscape"
            aria-label="Illustration of a sun setting behind green hills"
            role="img"
          >
            <div className="field-sun" />
            <div className="field-hill field-hill-back" />
            <div className="field-hill field-hill-front" />
            <div className="field-tree field-tree-one">✳</div>
            <div className="field-tree field-tree-two">✳</div>
            <span className="field-landscape-caption">
              A PLACE TO GET LOST, A PLACE TO BE FOUND
            </span>
          </div>
          <div className="field-hero-bottom">
            <span>EST. 2026 / ALWAYS OUTSIDE</span>
            <span>KEEP GOING ↓</span>
          </div>
        </section>

        <section className="field-manifesto">
          <span className="field-kicker">A NOTE FOR THE WANDERER / 001</span>
          <div className="field-manifesto-content">
            <h2>
              You don't have to
              <br />
              go <em>far</em> to feel far away.
            </h2>
            <div>
              <p>
                Take the turning you usually pass. Stop when the light changes. Pick a path because
                its name sounds lovely.
              </p>
              <p>
                Fieldwork collects the places that remind us to look up. No summit to conquer. No
                miles to make up. Just a little space to breathe.
              </p>
            </div>
          </div>
        </section>

        <section className="field-routes" id="routes">
          <div className="field-section-heading">
            <span>OUR FIELD GUIDE / 002</span>
            <span>THREE WALKS TO START WITH</span>
          </div>
          <h2>
            Choose a <em>direction.</em>
          </h2>
          <div className="field-route-grid">
            {trails.map((trail) => (
              <article className="field-route" key={trail.index}>
                <div
                  className={`field-route-art field-route-art-${trail.className}`}
                  aria-hidden="true"
                >
                  <span>{trail.index}</span>
                  <div className="field-route-orbit" />
                </div>
                <div className="field-route-meta">
                  <span>{trail.region}</span>
                  <span>{trail.distance}</span>
                </div>
                <h3>{trail.name}</h3>
                <p>A route for noticing the things you usually walk right past.</p>
              </article>
            ))}
          </div>
        </section>

        <section className="field-log">
          <div className="field-log-illustration" aria-hidden="true">
            <span className="field-log-leaf">❧</span>
            <span>
              SPECIMEN NO. 07
              <br />
              FOUND ALONG THE WAY
            </span>
          </div>
          <div className="field-log-copy">
            <span className="field-kicker">FROM THE TRAIL JOURNAL / 003</span>
            <h2>
              For the things
              <br />
              we almost <em>missed.</em>
            </h2>
            <p>
              Some journeys are measured in moments, not miles. A tiny fern in a stone wall. The way
              the rain leaves everything shining. We write them down so we don't forget.
            </p>
            <div className="field-log-rule">
              <span>OBSERVATION NO. 17</span>
              <span>THE BEST PART WASN'T ON THE MAP.</span>
            </div>
          </div>
        </section>

        <section className="field-end">
          <span>THE END OF THE PATH IS JUST THE BEGINNING</span>
          <h2>
            See you <em>out there.</em>
          </h2>
          <p>Pack light. Bring your curiosity.</p>
          <a href="#top">BACK TO THE BEGINNING ↑</a>
        </section>
      </main>
      <footer className="field-footer">
        <strong>✳ FIELDWORK</strong>
        <span>A SMALL ATLAS FOR BIG DAYS</span>
        <span>© 2026 FIELDWORK</span>
      </footer>
    </div>
  )
}

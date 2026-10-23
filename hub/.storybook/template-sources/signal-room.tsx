import "./styles.css"

const stations = [
  { id: "ST–01", name: "North pier", area: "COASTAL ARRAY", value: "18.4°", status: "NOMINAL" },
  { id: "ST–02", name: "High meadow", area: "UPLAND ARRAY", value: "12.8°", status: "NOMINAL" },
  { id: "ST–03", name: "East basin", area: "WATERSHED", value: "16.1°", status: "WATCH" },
  { id: "ST–04", name: "Outer point", area: "COASTAL ARRAY", value: "14.7°", status: "NOMINAL" },
]
const readings = [
  28, 37, 33, 49, 41, 53, 61, 52, 68, 59, 75, 71, 64, 84, 78, 90, 81, 72, 85, 76, 69, 77, 66, 74,
]

export function HomePage() {
  return (
    <div className="signal-page" id="top">
      <header className="signal-nav">
        <a className="signal-logo" href="#top">
          <span className="signal-logo-symbol">◉</span> SIGNAL / ROOM
        </a>
        <span>LIVE FIELD CONDITIONS</span>
        <a href="#stations" className="signal-nav-link">
          <span className="signal-live-dot" /> ALL SYSTEMS ONLINE ↗
        </a>
      </header>
      <main>
        <section className="signal-hero">
          <div className="signal-topline">
            <span>ENVIRONMENTAL OBSERVATORY / 2026</span>
            <span>ISSUE 004 — THE OPEN AIR</span>
          </div>
          <div className="signal-headline">
            <div>
              <div className="signal-eyebrow">
                <span className="signal-live-dot" /> TRANSMITTING FROM THE FIELD
              </div>
              <h1>
                The world,
                <br />
                <em>in real time.</em>
              </h1>
            </div>
            <p>
              There is a story in every change of weather. Follow the measurements. Find the moments
              that matter.
            </p>
          </div>
          <div className="signal-hero-bottom">
            <span>04 ACTIVE STATIONS</span>
            <span>SCROLL TO EXPLORE ↓</span>
            <span>UPDATED CONTINUOUSLY*</span>
          </div>
        </section>

        <section className="signal-overview" aria-label="Observatory overview">
          <div className="signal-section-title">
            <span>01 / CURRENT CONDITIONS</span>
            <span>REGIONAL OVERVIEW</span>
          </div>
          <div className="signal-metrics">
            <div className="signal-metric">
              <span>MEAN TEMPERATURE</span>
              <strong>
                15.5<small>°C</small>
              </strong>
              <span>↗ +1.2° FROM YESTERDAY</span>
            </div>
            <div className="signal-metric">
              <span>WIND SPEED</span>
              <strong>
                08<small>KM/H</small>
              </strong>
              <span>↘ -3 KM/H FROM YESTERDAY</span>
            </div>
            <div className="signal-metric">
              <span>AIR QUALITY</span>
              <strong>
                42<small>AQI</small>
              </strong>
              <span>● GOOD CONDITIONS</span>
            </div>
          </div>
          <div className="signal-chart">
            <div className="signal-chart-header">
              <div>
                <span>READING / 001</span>
                <h2>A day in motion.</h2>
              </div>
              <span>TEMPERATURE VARIATION · LAST 24 HOURS</span>
            </div>
            <div className="signal-bars" aria-label="Illustrative hourly temperature readings">
              {readings.map((height, index) => (
                <div className="signal-bar" style={{ height: `${height}%` }} key={index}>
                  <span>{String(index).padStart(2, "0")}:00</span>
                </div>
              ))}
            </div>
            <div className="signal-chart-axis">
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>23:00</span>
            </div>
          </div>
        </section>

        <section className="signal-stations" id="stations">
          <div className="signal-section-title">
            <span>02 / THE NETWORK</span>
            <span>4 STATIONS IN THE FIELD</span>
          </div>
          <div className="signal-stations-heading">
            <h2>
              Everywhere
              <br />
              <em>at once.</em>
            </h2>
            <p>Four listening posts. One living picture of the places around us.</p>
          </div>
          <div className="signal-station-list">
            {stations.map((station) => (
              <div className="signal-station" key={station.id}>
                <span className="signal-station-id">{station.id}</span>
                <div>
                  <h3>{station.name}</h3>
                  <span>{station.area}</span>
                </div>
                <strong>{station.value}</strong>
                <span className={station.status === "WATCH" ? "signal-watch" : "signal-nominal"}>
                  ● {station.status}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="signal-dispatch">
          <div className="signal-dispatch-art" aria-hidden="true">
            <div className="signal-dispatch-orbit">
              <div className="signal-dispatch-core">◉</div>
            </div>
            <span>LISTEN CLOSELY / LOOK FURTHER</span>
          </div>
          <div className="signal-dispatch-copy">
            <span>03 / A NOTE FROM THE FIELD</span>
            <h2>
              Data is a way
              <br />
              of <em>paying attention.</em>
            </h2>
            <p>
              Behind every number is a place changing in its own time. This is a small reminder to
              notice what the world is telling us.
            </p>
            <div className="signal-dispatch-rule">
              OBSERVATION IS AN ACT OF CARE <span>↗</span>
            </div>
          </div>
        </section>
        <section className="signal-end">
          <span>END OF TRANSMISSION / FOR NOW</span>
          <h2>
            Stay <em>tuned.</em>
          </h2>
          <a href="#top">RETURN TO THE TOP ↑</a>
        </section>
      </main>
      <footer className="signal-footer">
        <strong>◉ SIGNAL / ROOM</strong>
        <span>*ILLUSTRATIVE DATA FOR THIS LOCAL DEMO</span>
        <span>© 2026</span>
      </footer>
    </div>
  )
}

import "./styles.css"

const editions = [
  { number: "01", title: "The art of starting over", category: "Essay", time: "8 min read" },
  { number: "02", title: "A room of our own", category: "Conversation", time: "12 min read" },
  { number: "03", title: "Things worth keeping", category: "Field notes", time: "6 min read" },
  { number: "04", title: "Tomorrow is a place", category: "Photo story", time: "9 min read" },
]

export function HomePage() {
  return (
    <div className="welcome-page">
      <header className="welcome-nav">
        <a className="welcome-wordmark" href="#top">
          elsewhere<span>®</span>
        </a>
        <span className="welcome-nav-note">An independent journal for curious people.</span>
        <a className="welcome-nav-link" href="#stories">
          Explore the issue <span aria-hidden="true">↗</span>
        </a>
      </header>

      <main id="top">
        <section className="welcome-hero" aria-labelledby="welcome-title">
          <div className="welcome-hero-top">
            <span>
              ISSUE NO. 001 <span className="welcome-star">✳</span> SEPTEMBER 2026
            </span>
            <span>PRINTED IN THE IMAGINATION</span>
          </div>
          <h1 id="welcome-title">
            Make room
            <br />
            for <em>wonder.</em>
          </h1>
          <div className="welcome-hero-bottom">
            <p>
              A small publication about the big feeling of being somewhere new. Come in. Stay
              awhile.
            </p>
            <div className="welcome-seal" aria-hidden="true">
              <span>e.</span>
              <small>
                KEEP
                <br />
                LOOKING
              </small>
            </div>
          </div>
        </section>

        <section className="welcome-intro" id="stories">
          <div className="welcome-section-label">
            <span>01 / A NOTE FROM US</span>
            <span>↓ SCROLL TO READ</span>
          </div>
          <div className="welcome-intro-body">
            <h2>
              Good things happen
              <br />
              when we <i>look closer.</i>
            </h2>
            <div>
              <p>
                There is a particular magic in the everyday. The light at four in the afternoon. A
                stranger who remembers your name. The sound of a city waking up.
              </p>
              <p>
                Elsewhere is a home for those details. Each issue is a collection of voices, places,
                and ideas worth slowing down for.
              </p>
              <a href="#contents" className="welcome-text-link">
                Inside this issue <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </section>

        <section className="welcome-feature" aria-labelledby="welcome-feature-title">
          <div className="welcome-feature-art" aria-hidden="true">
            <div className="welcome-sun" />
            <div className="welcome-horizon" />
            <span>THE LONG WAY HOME</span>
          </div>
          <div className="welcome-feature-copy">
            <span className="welcome-eyebrow">FEATURE STORY / 001</span>
            <h2 id="welcome-feature-title">
              The long way
              <br />
              <i>home.</i>
            </h2>
            <p>
              What if the scenic route is the point? An invitation to wander, get lost, and find
              something better than what you were looking for.
            </p>
            <span className="welcome-feature-credit">WORDS BY MARA ELLIS · 10 MIN READ</span>
          </div>
        </section>

        <section className="welcome-contents" id="contents">
          <div className="welcome-section-label">
            <span>02 / THE CONTENTS</span>
            <span>FOUR WAYS TO BEGIN AGAIN</span>
          </div>
          <h2>
            In this <i>issue.</i>
          </h2>
          <div className="welcome-story-list">
            {editions.map((edition) => (
              <div className="welcome-story" key={edition.number}>
                <span className="welcome-story-number">{edition.number}</span>
                <h3>{edition.title}</h3>
                <span className="welcome-story-meta">
                  {edition.category} / {edition.time}
                </span>
                <span className="welcome-story-arrow" aria-hidden="true">
                  ↗
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="welcome-closing">
          <span>UNTIL NEXT TIME</span>
          <h2>
            Stay a little
            <br />
            <i>curious.</i>
          </h2>
          <p>The world is much bigger when you pay attention.</p>
          <div className="welcome-closing-mark" aria-hidden="true">
            ✳
          </div>
        </section>
      </main>
      <footer className="welcome-footer">
        <span>elsewhere®</span>
        <span>MADE FOR THE IN-BETWEEN MOMENTS</span>
        <a href="#top">BACK TO TOP ↑</a>
      </footer>
    </div>
  )
}

import validation from '../data/validation.json';
import { fmt } from '../lib/format';
import { KatexProvider, Tex } from './Tex';

type Opt = (typeof validation.optimum)[number];

export function HowItWorks() {
  return (
    <section className="how" id="how-it-works" aria-labelledby="how-title">
      <header className="how__head">
        <p className="eyebrow">Notes on the model</p>
        <h2 id="how-title">How it works</h2>
        <p className="how__lede">
          Heliograph is a <strong>planning calculator built on published models</strong>, running
          entirely in your browser. The sun position is validated against NOAA, JPL Horizons and the
          US Naval Observatory to better than 0.01°. The default clear-sky irradiance is an{' '}
          <strong>upper bound</strong>: real skies have clouds and more haze. “Long-term average”
          mode rescales it to NASA POWER’s 2001–2020 monthly normals. Neither is a yield guarantee.
        </p>
      </header>
      <KatexProvider>
        <div className="how__grid">
          <article>
            <h3>
              <span>1</span> Where the Sun is
            </h3>
            <p>
              The NOAA solar calculator algorithm (after Meeus, <em>Astronomical Algorithms</em>).
              From the Julian century <Tex>{String.raw`T=(\mathrm{JD}-2451545)/36525`}</Tex> it
              computes the Sun’s mean longitude and anomaly, the equation of centre, the apparent
              longitude <Tex>{String.raw`\lambda`}</Tex> and the obliquity{' '}
              <Tex>{String.raw`\varepsilon`}</Tex>:
            </p>
            <Tex
              block
            >{String.raw`\begin{gathered}\delta=\arcsin(\sin\varepsilon\,\sin\lambda)\\ E = 4\left[y\sin 2L_0-2e\sin M+4ey\sin M\cos 2L_0-\tfrac12y^2\sin 4L_0-\tfrac54e^2\sin 2M\right]\end{gathered}`}</Tex>
            <p>
              with <Tex>{String.raw`y=\tan^2(\varepsilon/2)`}</Tex> and <Tex>E</Tex> in minutes.
              True solar time gives the hour angle{' '}
              <Tex>{String.raw`h=\mathrm{TST}/4-180^\circ`}</Tex>, then
            </p>
            <Tex
              block
            >{String.raw`\begin{gathered}\cos\theta_z=\sin\varphi\sin\delta+\cos\varphi\cos\delta\cos h\\ \gamma_s=180^\circ+\operatorname{atan2}\!\big(\sin h,\ \cos h\sin\varphi-\tan\delta\cos\varphi\big)\end{gathered}`}</Tex>
            <p>
              Elevation includes NOAA’s piecewise refraction fit. Sunrise and sunset are where the
              Sun’s centre crosses the 90.833° zenith (34′ refraction + 16′ solar radius), the
              condition NOAA solves with <Tex>{String.raw`\cos h_0`}</Tex>. Here the noon-centred
              day is sampled every 10 minutes (including both midnights and noon) and each crossing
              is refined by bisection, so transition days near the poles, when the Sun dips below
              the horizon for only a few minutes, are found too. No crossing at all means polar day
              or night.
            </p>
          </article>

          <article>
            <h3>
              <span>2</span> How much light arrives
            </h3>
            <p>
              Outside the atmosphere the Sun delivers the total solar irradiance of 1361 W/m² (Kopp
              &amp; Lean 2011), scaled by the Earth–Sun distance <Tex>r</Tex>:
            </p>
            <Tex block>{String.raw`E_0 = 1361\ \mathrm{W\,m^{-2}}\cdot(1\,\mathrm{AU}/r)^2`}</Tex>
            <p>
              Under a cloudless sky the <strong>simplified Solis</strong> model (Ineichen 2008)
              attenuates it with aerosol optical depth at 700 nm, precipitable water and air
              pressure (from the site altitude):
            </p>
            <Tex
              block
            >{String.raw`\mathrm{DNI}=I_0'\,e^{-\tau_b/\sin^{b}\!\alpha},\qquad \mathrm{DHI}=I_0'\,e^{-\tau_d/\sin^{d}\!\alpha},\qquad \mathrm{GHI}=\mathrm{DNI}\sin\alpha+\mathrm{DHI}`}</Tex>
            <p>
              <Tex>{String.raw`\alpha`}</Tex> is the apparent elevation. Solis fits GHI separately;
              its three outputs differ from closure by up to ~14 W/m², so GHI is taken by closure to
              keep the horizontal-plane identity exact.
            </p>
          </article>

          <article>
            <h3>
              <span>3</span> Onto the panel
            </h3>
            <p>
              For a panel tilted <Tex>{String.raw`\beta`}</Tex> and facing azimuth{' '}
              <Tex>{String.raw`\gamma`}</Tex>:
            </p>
            <Tex
              block
            >{String.raw`G_\mathrm{POA}=\mathrm{DNI}\,\max(0,\cos\theta)\,V_\odot+D_\mathrm{sky}+\rho\,\mathrm{GHI}\,\frac{1-\cos\beta}{2}`}</Tex>
            <Tex
              block
            >{String.raw`\cos\theta=\cos\beta\cos\theta_z+\sin\beta\sin\theta_z\cos(\gamma_s-\gamma)`}</Tex>
            <p>
              The sky-diffuse part uses <strong>Perez 1990</strong> (all-sites composite
              coefficients), which splits the sky into an isotropic dome, a circumsolar disc and a
              horizon band; <strong>Hay–Davies</strong> is available for comparison:
            </p>
            <Tex
              block
            >{String.raw`D_\mathrm{sky}^{\mathrm{Perez}}=\mathrm{DHI}\Big[(1-F_1)\,F_\mathrm{sky}+F_1\frac{\max(0,\cos\theta)}{\max(\cos 85^\circ,\cos\theta_z)}+F_2\sin\beta\Big]`}</Tex>
            <p>
              <Tex>{String.raw`F_1,F_2`}</Tex> come from the sky clearness{' '}
              <Tex>{String.raw`\varepsilon`}</Tex> and brightness <Tex>{String.raw`\Delta`}</Tex>{' '}
              (Kasten–Young air mass). The ground reflects isotropically with albedo{' '}
              <Tex>{String.raw`\rho`}</Tex>.
            </p>
          </article>

          <article>
            <h3>
              <span>4</span> Shading by the skyline
            </h3>
            <p>
              The skyline is a closed polyline of (azimuth, elevation) points, the PVGIS/PVsyst
              convention. The beam and the circumsolar light are blocked when the Sun is below it:{' '}
              <Tex>{String.raw`V_\odot=[\,\alpha>h_\mathrm{sky}(\gamma_s)\,]`}</Tex>. The isotropic
              dome loses the part of the sky the panel can no longer see:
            </p>
            <Tex
              block
            >{String.raw`F_\mathrm{sky}=\frac{1+\cos\beta}{2}-\frac1\pi\int_0^{2\pi}\!\!\int_0^{h_\mathrm{sky}(\phi)}\!\max\!\big(0,\ \hat n\cdot\hat s(\phi,e)\big)\cos e\,\mathrm de\,\mathrm d\phi`}</Tex>
            <p>
              integrated analytically in elevation for each 1° sector (checked against brute-force
              integration to 0.004). The horizon band <Tex>{String.raw`F_2`}</Tex> is scaled by its
              visible fraction. In 3D the skyline appears as blocks whose tops subtend the same
              elevation from the panel.
            </p>
          </article>

          <article>
            <h3>
              <span>5</span> Finding the best orientation
            </h3>
            <p>
              Everything that does not depend on the panel (sun vector, irradiance, Perez
              coefficients, skyline visibility) is computed once per 15-minute step of the year in a
              Web Worker. Energy for one orientation is then a single pass:
            </p>
            <Tex
              block
            >{String.raw`E(\beta,\gamma)=\sum_{t\in\text{period}}G_\mathrm{POA}(t;\beta,\gamma)\,\Delta t`}</Tex>
            <p>
              The landscape is sampled every 2.5° of tilt and 5° of azimuth, and the best cell is
              refined by nested golden-section searches (ratio 0.618, to 0.01°). Re-tilting
              optimises each season’s tilt at the optimum azimuth (the mount may tip either way).
              The single-axis tracker turns about a horizontal north–south axis to{' '}
              <Tex>{String.raw`R=\operatorname{atan2}(s_x,s_z)`}</Tex>, limited to ±60°; the
              two-axis tracker faces the Sun.
            </p>
          </article>

          <article>
            <h3>
              <span>6</span> From sunlight to electricity
            </h3>
            <p>
              Cell temperature from the NOCT model, then power with a linear temperature coefficient
              and system losses:
            </p>
            <Tex
              block
            >{String.raw`\begin{gathered}T_c=T_a+\frac{\mathrm{NOCT}-20^\circ\mathrm C}{800\ \mathrm{W\,m^{-2}}}\,G_\mathrm{POA}\\ P=P_\mathrm{STC}\,\frac{G_\mathrm{eff}}{1000}\,\big[1+\gamma_P\,(T_c-25^\circ\mathrm C)\big](1-L)\end{gathered}`}</Tex>
            <p>
              <Tex>{String.raw`G_\mathrm{eff}`}</Tex> applies the ASHRAE incidence-angle modifier{' '}
              <Tex>{String.raw`1-b_0(1/\cos\theta-1)`}</Tex> with <Tex>{String.raw`b_0=0.05`}</Tex>{' '}
              to the beam and circumsolar light. Losses <Tex>L</Tex> default to 14 % (PVWatts’
              default).
            </p>
          </article>

          <article>
            <h3>
              <span>7</span> Long-term averages
            </h3>
            <p>
              NASA POWER’s climatology API (CORS-enabled; cached on this device, bundled for the
              preset cities) provides monthly mean GHI, diffuse and air temperature. Each month’s
              clear-sky profiles are rescaled so monthly totals match:
            </p>
            <Tex
              block
            >{String.raw`k_{D,m}=\frac{\mathrm{DIFF}_m}{\overline{\mathrm{DHI}}_{\mathrm{clear},m}},\qquad k_{B,m}=\frac{\mathrm{GHI}_m-\mathrm{DIFF}_m}{\overline{\mathrm{DNI}\sin\alpha}_{\mathrm{clear},m}}`}</Tex>
            <p>
              POWER’s own DNI is not used: in the tropics it is inconsistent with its GHI and
              diffuse (for Singapore the implied mean <Tex>{String.raw`\cos\theta_z`}</Tex> exceeds
              1). Air temperature follows{' '}
              <Tex>{String.raw`T_{2M}+\tfrac12\Delta T\cos\big(2\pi(t-15\,\mathrm h)/24\big)`}</Tex>
              .
            </p>
          </article>

          <article className="how__limits">
            <h3>
              <span>8</span> Assumptions and limits
            </h3>
            <ul>
              <li>
                Clear-sky numbers are an upper bound; long-term averages describe a typical year,
                not any real one.
              </li>
              <li>
                Average days come from scaled clear-sky shapes, so day-to-day variability (and its
                effect on tracker gains) is lost.
              </li>
              <li>
                The skyline is a far-field horizon seen from one point; near objects that shade part
                of an array are not modelled.
              </li>
              <li>
                The ground reflects isotropically and is not shaded; snow, soiling and spectral
                effects are outside the model.
              </li>
              <li>
                Trackers ignore backtracking, row-to-row shading and the land they need. Seasonal
                dates are fixed calendar days.
              </li>
              <li>
                Sun position assumes ΔT ≈ 0 and standard refraction; near the horizon real
                refraction varies by minutes of time.
              </li>
              <li>
                NASA POWER cells are 0.5°–1° wide, so mountains, coasts and valleys within a cell
                are averaged.
              </li>
            </ul>
          </article>
        </div>

        <div className="how__validation">
          <h3 id="validation">Validation</h3>
          <p>
            Regenerated with <code>npm run validate</code> ({validation.generated}); the same
            references drive the unit tests.
          </p>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Sun position validation"
          >
            <table className="data-table data-table--wide">
              <caption>
                Sun position against the NOAA Solar Calculator (values shown by the live page)
              </caption>
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Elevation NOAA / here</th>
                  <th scope="col">Azimuth NOAA / here</th>
                  <th scope="col">Sunrise NOAA / here</th>
                  <th scope="col">Sunset NOAA / here</th>
                  <th scope="col">Solar noon NOAA / here</th>
                </tr>
              </thead>
              <tbody>
                {validation.noaa.map((n) => (
                  <tr key={n.case}>
                    <th scope="row">{n.case}</th>
                    <td>
                      {n.elevation.ref}° / {n.elevation.got}°
                    </td>
                    <td>
                      {n.azimuth.ref}° / {n.azimuth.got}°
                    </td>
                    <td>
                      {n.sunrise.ref} / {n.sunrise.got}
                    </td>
                    <td>
                      {n.sunset.ref} / {n.sunset.got}
                    </td>
                    <td>
                      {n.noon.ref} / {n.noon.got}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field__hint">
            JPL Horizons (refracted apparent position): largest difference{' '}
            {fmt(
              Math.max(
                ...validation.horizons.map((h) => Math.max(Math.abs(h.dEl), Math.abs(h.dAz))),
              ),
              4,
            )}
            ° over four cases. USNO rise/set: identical to the minute. Solar noon differs from NOAA
            by up to 15 s because NOAA’s calculator evaluates the equation of time half a day early;
            USNO’s transit times agree with ours.
          </p>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Optimum tilt validation"
          >
            <table className="data-table data-table--wide">
              <caption>
                Optimum fixed tilt (equator-facing) against PVGIS 5.3 and the Jacobson &amp; Jadhav
                (2018) fit
              </caption>
              <thead>
                <tr>
                  <th scope="col">Place</th>
                  <th scope="col">PVGIS 5.3</th>
                  <th scope="col">J&amp;J fit</th>
                  <th scope="col">Here, long-term average</th>
                  <th scope="col">Here, clear sky</th>
                  <th scope="col">PVGIS angle captures</th>
                </tr>
              </thead>
              <tbody>
                {validation.optimum.map((o: Opt) => (
                  <tr key={o.place}>
                    <th scope="row">
                      {o.place} <small>({fmt(o.lat, 1)}°)</small>
                    </th>
                    <td>{o.pvgis}°</td>
                    <td>{fmt(o.jj, 1)}°</td>
                    <td>{fmt(o.climateTilt, 1)}°</td>
                    <td>{fmt(o.clearTilt, 1)}°</td>
                    <td>{fmt(o.capturedPct, 2)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field__hint">
            With long-term averages the optimum lies within 2.5° of PVGIS outside the tropics (3.3°
            and 4.3° at the two equatorial sites, where the landscape is almost flat: PVGIS’s angle
            still captures over 99.7 % of our optimum). Clear skies push the optimum steeper — by up
            to 10° in cloudy Reykjavík — because cloud light is diffuse and favours flatter panels,
            and cloudy winters weight the year towards the high summer Sun. Where summers are the
            cloudier season (the Phoenix monsoon, Sydney) the clear-sky optimum is about 1° flatter
            instead.
          </p>
          <p className="field__hint">
            Irradiance models reproduce pvlib-python’s regression values: simplified Solis to{' '}
            {validation.models.solisMaxAbs.toExponential(0)} W/m², Perez to{' '}
            {fmt(validation.models.perezMaxAbs, 3)} W/m², Hay–Davies to{' '}
            {validation.models.hayDaviesMaxAbs.toExponential(0)} W/m²; a flat panel receives exactly
            GHI and a panel facing the Sun receives exactly DNI as beam.
          </p>
        </div>

        <div className="how__refs">
          <h3>References</h3>
          <ol>
            <li>
              NOAA Global Monitoring Laboratory, Solar Calculator and its equations,
              gml.noaa.gov/grad/solcalc.
            </li>
            <li>
              J. Meeus, <em>Astronomical Algorithms</em>, 2nd ed., Willmann-Bell, 1998.
            </li>
            <li>
              G. Kopp &amp; J. Lean, “A new, lower value of total solar irradiance”,{' '}
              <em>Geophys. Res. Lett.</em> 38, L01706, 2011.
            </li>
            <li>
              P. Ineichen, “A broadband simplified version of the Solis clear sky model”,{' '}
              <em>Solar Energy</em> 82, 758–762, 2008.
            </li>
            <li>
              R. Perez et al., “Modeling daylight availability and irradiance components from direct
              and global irradiance”, <em>Solar Energy</em> 44, 271–289, 1990.
            </li>
            <li>
              J. E. Hay &amp; J. A. Davies, “Calculation of the solar radiation incident on an
              inclined surface”, Proc. First Canadian Solar Radiation Data Workshop, 1980.
            </li>
            <li>
              F. Kasten &amp; A. T. Young, “Revised optical air mass tables and approximation
              formula”, <em>Applied Optics</em> 28, 4735–4738, 1989.
            </li>
            <li>
              M. Z. Jacobson &amp; V. Jadhav, “World estimates of PV optimal tilt angles…”,{' '}
              <em>Solar Energy</em> 169, 55–66, 2018.
            </li>
            <li>
              NASA POWER Climatology API (LaRC), power.larc.nasa.gov; PVGIS 5.3 (EU JRC);
              pvlib-python (Holmgren et al., JOSS 2018).
            </li>
          </ol>
        </div>
      </KatexProvider>
    </section>
  );
}

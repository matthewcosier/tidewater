import { DisasterField } from './Field.js';
import { freshSeed } from './EventRandom.js';

export const HEIGHT_MIN = 1; // m: a beach surge
export const HEIGHT_MAX = 3000; // m: overtops the 305.5 m summit ten times over
export const SLIDER_STEPS = 1000; // log steps across the range: 0.8 % of height per step
export const PRESETS = Object.freeze( [
	{ name: 'Surge', height: 2 },
	{ name: 'Severe', height: 10 },
	{ name: 'Catastrophic', height: 40 },
	{ name: 'Overtop', height: 320 }, // the peak is 305.5 m
	{ name: 'Mega', height: 3000 },
] );
// Warning lead (s). "None" is the field's shortest lead (LIMITS.warningLead 3 s): the source still
// needs a launch moment. Long is the old 90 s default.
export const WARNINGS = Object.freeze( { none: 3, short: 20, long: 90 } );
// Lab fields that move under Advanced while the tsunami is chosen (they stay in the main grid for
// the other disasters).
const ADVANCED_KEYS = [ 'x', 'z', 'intensity', 'radius', 'duration', 'warningLead', 'width' ];

const LOG_SPAN = Math.log( HEIGHT_MAX / HEIGHT_MIN );

// Display precision: 0.1 m under 10 m, 1 m under 100 m, 10 m above. Every preset lands exactly.
function roundHeight( H ) {

	if ( H < 10 ) return Math.round( H * 10 ) / 10;
	if ( H < 100 ) return Math.round( H );
	return Math.round( H / 10 ) * 10;

}

export function heightFromSlider( step ) {

	const t = Math.min( 1, Math.max( 0, Number( step ) / SLIDER_STEPS ) );
	return Math.min( HEIGHT_MAX, Math.max( HEIGHT_MIN, roundHeight( HEIGHT_MIN * Math.exp( t * LOG_SPAN ) ) ) );

}

export function sliderFromHeight( H ) {

	if ( ! ( H > 0 ) ) return 0;
	return Math.min( SLIDER_STEPS, Math.max( 0, Math.round( SLIDER_STEPS * Math.log( H / HEIGHT_MIN ) / LOG_SPAN ) ) );

}

// Run-up R (m) of a long wave of height H (m) arriving through water d (m) deep over a plane beach of
// slope 1 : cot. Synolakis (1987), "The runup of solitary waves", J. Fluid Mech. 185: non-breaking
// R/d = 2.831 sqrt(cot) (H/d)^1.25, breaking R/d = 0.918 (H/d)^0.606. Taking the lower of the two is
// the breaking law past the breaking limit and keeps R continuous in H (the laws cross just below
// it). A wave taller than its run-up law arrives as a wall and floods to at least its own height.
export function runUp( H, d, cot ) {

	const ratio = H / d;
	const plain = 2.831 * d * Math.sqrt( cot ) * Math.pow( ratio, 1.25 );
	const breaking = 0.918 * d * Math.pow( ratio, 0.606 );
	return Math.max( H, Math.min( plain, breaking ) );

}

// The field's own approach plan for this config. A probe field with its water slot already filled
// runs DisasterField.start, so the readout uses the same planner as the event (planApproach) without
// building the 257 x 257 grid. Throws RangeError on an invalid config, as start does.
const PLANNED = Object.freeze( { planned: true } );
export function planTsunami( terrain, config ) {

	const probe = Object.create( DisasterField.prototype );
	probe.terrain = terrain;
	probe.events = new Map();
	probe.airModifiers = new Set();
	probe.time = 0;
	probe.water = PLANNED;
	probe.outer = PLANNED;
	const e = probe.start( 'tsunami', config );
	const a = e.direction * Math.PI / 180;
	const sx = e.x - Math.cos( a ) * e.launchDistance, sz = e.z - Math.sin( a ) * e.launchDistance;
	const depth = Math.max( 1, - terrain( sx, sz ) ); // m of water at the source
	const cot = Math.max( 1, e.launchDistance / depth ); // mean slope from the source to the target
	return { arrival: e.arrival, approach: e.approach, warning: e.warning, depth, cot, runUp: runUp( e.intensity, depth, cot ) };

}

const formatHeight = H => H < 10 ? `${ H.toFixed( 1 ) } m` : `${ Math.round( H ).toLocaleString( 'en' ) } m`;

const STYLE = `
.disaster-panel .tsunami-controls{display:grid;gap:12px;margin:14px 0 4px;padding:12px;border:1px solid var(--tw-line-2,#4e6a72);border-radius:var(--tw-r-md,10px);background:var(--tw-fill,#ffffff0d)}
.disaster-panel .tsunami-controls[hidden],.disaster-panel .disaster-advanced[hidden]{display:none!important}
.disaster-panel .tsunami-height{display:grid;grid-template-columns:1fr auto;align-items:baseline;gap:6px 12px}
.disaster-panel .tsunami-height span{font-size:11px;color:#bdd2d6}
.disaster-panel .tsunami-controls output{display:block;margin:0;padding:0;border:0}
.disaster-panel .tsunami-height output{font:600 18px/1.1 var(--tw-font,system-ui);font-variant-numeric:tabular-nums;color:var(--tw-ink,#eef6f8)}
.disaster-panel .tsunami-height input[type=range]{grid-column:1/-1;width:100%;margin:0;padding:0;border:0;background:none;accent-color:var(--tw-aqua,#5fe3d4)}
.disaster-panel .tsunami-presets{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}
.disaster-panel .tsunami-presets button{grid-column:span 2;display:flex;flex-direction:column;align-items:center;gap:1px;padding:6px 4px;line-height:1.2;white-space:nowrap}
.disaster-panel .tsunami-presets button:nth-child(n+4){grid-column:span 3}
.disaster-panel .tsunami-presets button small{font-weight:400;font-size:10.5px;color:inherit;opacity:.75}
.disaster-panel .tsunami-presets button[aria-pressed=true]{background:var(--tw-aqua,#5fe3d4);border-color:var(--tw-aqua,#5fe3d4);color:#08201f}
.disaster-panel .tsunami-readout{font-size:12px;line-height:1.5;color:#bdd2d6}
.disaster-panel .tsunami-readout b{color:var(--tw-ink,#eef6f8);font-variant-numeric:tabular-nums}
.disaster-panel .disaster-advanced>summary{font:600 12px system-ui;color:#bdd2d6}
.disaster-panel .disaster-advanced .disaster-fields{margin-bottom:0}
`;

export class TsunamiPanel {

	constructor( controls ) {

		this.controls = controls;
		const panel = controls.panel, inputs = controls.inputs;
		const style = document.createElement( 'style' );
		style.textContent = STYLE;
		document.head.append( style );
		this.fields = panel.querySelector( '.disaster-fields' );
		this.fieldOrder = [ ...this.fields.children ];

		this.block = document.createElement( 'div' );
		this.block.className = 'tsunami-controls';
		this.block.setAttribute( 'role', 'group' );
		this.block.setAttribute( 'aria-label', 'Tsunami' );
		this.block.innerHTML = `<div class="tsunami-height"><span>Wave height</span><output aria-label="Wave height value"></output>
<input type="range" aria-label="Wave height" min="0" max="${ SLIDER_STEPS }" step="1"></div>
<div class="tsunami-presets" role="group" aria-label="Wave height presets">${ PRESETS.map( p => `<button type="button" data-height="${ p.height }" aria-pressed="false">${ p.name }<small>${ formatHeight( p.height ) }</small></button>` ).join( '' ) }</div>
<label>Warning<select data-warning aria-label="Warning"><option value="none">None (${ WARNINGS.none } s)</option><option value="short">Short (${ WARNINGS.short } s)</option><option value="long">Long (${ WARNINGS.long } s)</option><option value="custom">Custom (set under Advanced)</option></select></label>
<output class="tsunami-readout" aria-label="Tsunami estimate"></output>`;
		// right above the target and direction, so every tsunami input reads as one group
		this.fields.before( this.block );

		this.advanced = document.createElement( 'details' );
		this.advanced.className = 'disaster-advanced';
		// Closed by default (decided 2026-10-05): the height, presets and warning are the panel; the lab
		// fields wait one click (or Enter on the summary) away. The ten browser journeys that fill them
		// open it first with a real click on the summary.
		this.advanced.open = false;
		this.advanced.innerHTML = '<summary>Advanced</summary><div class="disaster-fields"></div>';
		this.fields.after( this.advanced );
		this.advancedFields = this.advanced.querySelector( '.disaster-fields' );

		this.slider = this.block.querySelector( 'input[type=range]' );
		this.value = this.block.querySelector( '.tsunami-height output' );
		this.chips = [ ...this.block.querySelectorAll( '[data-height]' ) ];
		this.warning = this.block.querySelector( '[data-warning]' );
		this.readout = this.block.querySelector( '.tsunami-readout' );

		this.slider.addEventListener( 'input', () => this.setHeight( heightFromSlider( this.slider.value ) ) );
		for ( const chip of this.chips ) chip.addEventListener( 'click', () => this.setHeight( Number( chip.dataset.height ) ) );
		this.warning.addEventListener( 'change', () => {

			const lead = WARNINGS[ this.warning.value ];
			if ( lead !== undefined ) inputs.warningLead.value = String( lead );
			this.sync();

		} );
		for ( const key of [ 'intensity', 'warningLead', 'direction', 'x', 'z', 'width' ] ) inputs[ key ].addEventListener( 'input', () => this.sync() );
		inputs.target.addEventListener( 'change', () => this.sync() );

	}

	// The config Start hands the field: the inputs plus the seed the readout was planned on. A hidden block
	// (another disaster type) or a readout not yet drawn leaves the config alone, and the field draws its own.
	startConfig( config ) {

		return this.block.hidden || this.seed == null ? config : { ...config, seed: this.seed };

	}

	setHeight( H ) {

		this.controls.inputs.intensity.value = String( H );
		this.sync();

	}

	// Tsunami: the simple block on top, lab fields under Advanced. Other kinds: the original grid.
	layout( kind ) {

		const tsunami = kind === 'tsunami';
		this.block.hidden = ! tsunami;
		this.advanced.hidden = ! tsunami;
		const advanced = new Set( ADVANCED_KEYS.map( key => this.controls.inputs[ key ].closest( 'label' ) ) );
		if ( tsunami ) {

			this.fields.append( ...this.fieldOrder.filter( label => ! advanced.has( label ) ) );
			this.advancedFields.append( ...this.fieldOrder.filter( label => advanced.has( label ) ) );

		} else {

			this.fields.append( ...this.fieldOrder );

		}

		this.sync();

	}

	// Everything shown here is derived from the inputs the field reads.
	sync() {

		if ( this.block.hidden ) return;
		const inputs = this.controls.inputs, H = Number( inputs.intensity.value );
		this.slider.value = String( sliderFromHeight( H ) );
		this.slider.setAttribute( 'aria-valuetext', Number.isFinite( H ) ? formatHeight( H ) : '' );
		this.value.textContent = Number.isFinite( H ) ? formatHeight( H ) : '';
		for ( const chip of this.chips ) chip.setAttribute( 'aria-pressed', String( Number( chip.dataset.height ) === H ) );
		const lead = Number( inputs.warningLead.value );
		this.warning.value = Object.keys( WARNINGS ).find( name => WARNINGS[ name ] === lead ) ?? 'custom';
		const terrain = this.controls.owner.field?.terrain;
		this.seed = freshSeed();
		let plan = null;
		try {

			plan = terrain ? planTsunami( terrain, { ...this.controls.config(), seed: this.seed } ) : null;

		} catch {

			plan = null; // invalid input: the validation line under Start says why

		}

		this.readout.dataset.arrival = plan ? plan.arrival.toFixed( 1 ) : '';
		this.readout.dataset.runUp = plan ? plan.runUp.toFixed( 1 ) : '';
		this.readout.innerHTML = plan
			? `Crest arrives <b>${ Math.round( plan.arrival ) } s</b> after Start<br>${ Math.round( plan.warning ) } s warning, then ${ Math.round( plan.approach ) } s at sea<br>Run-up about <b>${ formatHeight( plan.runUp ) }</b> above the sea`
			: 'Set a valid height and target to see the arrival and run-up.';

	}

}

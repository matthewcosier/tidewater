import { VEHICLES } from '../rally/Vehicles.js';
import { STARTS } from '../rally/StartLocations.js';
import { playerAppearance, SHIRTS, SKIN_TONES } from '../player/Appearance.js';

const STORAGE = 'tidewater.appearance';
const options = ( labels ) => labels.map( ( label, i ) => `<option value="${ i }">${ label }</option>` ).join( '' );

// The island and LAN phone lobby share this DOM. Thumbnails keep the phone menu usable
// without WebGPU and let the island keep its GPU memory for the actual game.
export class IslandStart {
	constructor( root, assetBase, onStart, defaultCar = 'aster' ) {
		this.root = root;
		this.assetBase = assetBase;
		let appearance;
		try { appearance = JSON.parse( localStorage.getItem( STORAGE ) ); } catch { /* private browsing or old data */ }
		this.appearance = playerAppearance( appearance );
		this.car = defaultCar;
		root.innerHTML = `
			<div class="garage-sheet">
				<section class="garage-picker" aria-label="Island garage">
					<div class="garage-heading"><h1>Choose a car</h1><button type="button" class="garage-edit">Edit character</button></div>
					<div class="garage-grid">${ Object.entries( VEHICLES ).map( ( [ key, car ] ) => `
						<button type="button" data-car="${ key }" aria-label="${ car.name }" aria-pressed="false">
							<img src="${ assetBase }${ key }.webp" alt=""><strong>${ car.name }</strong><small>${ car.tag }</small>
						</button>` ).join( '' ) }</div>
					<div class="garage-footer"><label>Start location<select class="garage-location">${ Object.entries( STARTS ).map( ( [ key, label ] ) =>
						`<option value="${ key }">${ label }</option>` ).join( '' ) }</select></label>
					<button type="button" class="garage-walk tw-start-cta">Walk instead</button><button type="button" class="garage-drive"></button></div>
				</section>
				<section class="garage-editor" aria-label="Character appearance" hidden>
					<div class="garage-portrait"><img alt="Your character"></div>
					<div class="garage-fields"><h1>Your character</h1>
						<label>Skin tone<select data-look="tone">${ options( SKIN_TONES ) }</select></label>
						<label>Shirt<select data-look="shirt">${ options( SHIRTS ) }</select></label>
						<label>Field hat<select data-look="hat"><option value="on">Wear hat</option><option value="off">Take off</option></select></label>
						<button type="button" class="garage-done">Done</button>
					</div>
				</section>
			</div>`;
		const get = selector => root.querySelector( selector );
		this.picker = get( '.garage-picker' );
		this.editor = get( '.garage-editor' );
		this.drive = get( '.garage-drive' );
		this.walk = get( '.garage-walk' );
		this.location = get( '.garage-location' );
		this.location.value = 'coast';
		this.lookFields = [ ...this.editor.querySelectorAll( '[data-look]' ) ];
		this.edit = get( '.garage-edit' );
		this.picker.querySelector( '.garage-grid' ).addEventListener( 'click', event => {
			const button = event.target.closest( '[data-car]' );
			if ( button ) this.selectCar( button.dataset.car );
		} );
		this.edit.onclick = () => {
			this.picker.hidden = true; this.editor.hidden = false;
			this.updatePortrait();
			this.lookFields[ 0 ].focus();
		};
		get( '.garage-done' ).onclick = () => {
			this.editor.hidden = true; this.picker.hidden = false;
			this.edit.focus();
		};
		this.editor.addEventListener( 'change', event => {
			const { look } = event.target.dataset;
			if ( ! look ) return;
			this.appearance[ look ] = look === 'hat' ? event.target.value === 'on' : Number( event.target.value );
			this.updatePortrait();
		} );
		for ( const [ button, mode ] of [ [ this.drive, 'drive' ], [ this.walk, 'walk' ] ] ) {
			button.onclick = () => {
				try { localStorage.setItem( STORAGE, JSON.stringify( this.appearance ) ); } catch { /* storage disabled */ }
				onStart( { mode, car: this.car, location: this.location.value, appearance: { ...this.appearance } } );
			};
		}
		this.selectCar( defaultCar );
	}

	selectCar( key ) {
		this.car = key;
		for ( const button of this.picker.querySelectorAll( '[data-car]' ) )
			button.setAttribute( 'aria-pressed', String( button.dataset.car === key ) );
		this.drive.textContent = 'Drive ' + VEHICLES[ key ].name;
	}

	updatePortrait() {
		const { tone, shirt, hat } = this.appearance;
		for ( const field of this.lookFields ) field.value = field.dataset.look === 'hat' ? ( hat ? 'on' : 'off' ) : this.appearance[ field.dataset.look ];
		this.editor.querySelector( 'img' ).src = this.assetBase + `player-${ shirt }-${ tone }-${ hat ? 0 : 1 }.webp`;
	}
}

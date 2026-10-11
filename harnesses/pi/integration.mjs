import {selectCompatibility} from '../../lib/compatibility.mjs';
export async function piAdapter(version){
 const selected=selectCompatibility('pi',version);
 if(!selected.supported)throw new Error('Pi version is not supported by this parent adapter');
 return import('./v1/integration.mjs');
}

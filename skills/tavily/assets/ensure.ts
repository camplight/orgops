import { ensureTvlyInstalled } from "./_lib";

const res = ensureTvlyInstalled();
console.log(JSON.stringify(res, null, 2));

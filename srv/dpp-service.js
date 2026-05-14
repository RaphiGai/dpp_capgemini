'use strict';

// CAP auto-loads `srv/<service-name>.js` as the implementation for the matching
// service defined in `srv/<service-name>.cds`. Keeping this file as a thin
// delegate makes the handlers easier to unit-test in isolation.
module.exports = require('./handlers/dpp-handlers');

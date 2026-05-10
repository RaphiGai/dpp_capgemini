sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";

    return Controller.extend("launchpad.controller.Main", {

        onShow: function () {
            this.byId("productsTable").setVisible(true);
        },

        onHide: function () {
            this.byId("productsTable").setVisible(false);
        }

    });
});

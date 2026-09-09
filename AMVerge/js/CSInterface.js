/*************************************************************************
* ADOBE CONFIDENTIAL
* ___________________
*
* Copyright 2015 Adobe Systems Incorporated
* All Rights Reserved.
*
* NOTICE: All information contained herein is, and remains the property
* of Adobe Systems Incorporated and its suppliers, if any. The intellectual
* and technical concepts contained herein are proprietary to Adobe Systems
* Incorporated and its suppliers and are protected by all applicable
* intellectual property laws, including trade secret and copyright laws.
* Dissemination of this information or reproduction of this material
* is strictly forbidden unless prior written permission is obtained
* from Adobe Systems Incorporated.
*************************************************************************/
(function(){var t;function n(t){return typeof t==="function"}function r(t){var n=new CSInterface;return n.evalScript(t)}var e=function(){function t(){this._apiVersion=void 0;this._apiVersion=10}return t.prototype.getScope=function(){return this._apiVersion<10?void 0:new CSInterface.prototype.constructor.Scope},t.prototype.constructor=function(){return this._apiVersion},t}();t=CSInterface=e;t.prototype.constructor=t;t.prototype.evalScript=function(t,n){void 0===n&&(n=null);if(window.__adobe_cep_)return window.__adobe_cep_.evalScript(t,n);n&&n("")},t.prototype.getWindowWidth=function(){return window.__adobe_cep_?window.__adobe_cep_.getWindowWidth():0},t.prototype.getWindowHeight=function(){return window.__adobe_cep_?window.__adobe_cep_.getWindowHeight():0},t.prototype.resizeContent=function(t,n){window.__adobe_cep_&&window.__adobe_cep_.resizeContent(t,n)},t.prototype.getSystemPath=function(t){return window.__adobe_cep_?window.__adobe_cep_.getSystemPath(t):""},t.prototype.openURLInDefaultBrowser=function(t){window.__adobe_cep_&&window.__adobe_cep_.openURLInDefaultBrowser(t)},t.prototype.getExtensionID=function(){return window.__adobe_cep_?window.__adobe_cep_.getExtensionId():""},t.prototype.getHostEnvironment=function(){return window.__adobe_cep_?JSON.parse(window.__adobe_cep_.getHostEnvironment()):null},typeof CSInterface==="undefined"&&(window.CSInterface=t)})();

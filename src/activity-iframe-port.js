/**
 * @license
 * Copyright 2017 The Web Activities Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  ActivityMode,
  ActivityPortDef,
  ActivityResult,
  ActivityResultCode,
} from './activity-types';
import {Messenger} from './messenger';
import {getOriginFromUrl, resolveResult} from './utils';


/**
 * The `ActivityPort` implementation for the iframe case. Unlike other types
 * of activities, iframe-based activities are always connected and can react
 * to size requests.
 *
 * @implements {ActivityPortDef}
 */
export class ActivityIframePort {

  /**
   * @param {!HTMLIFrameElement} iframe
   * @param {string} url
   * @param {?Object=} opt_args
   */
  constructor(iframe, url, opt_args) {
    /** @private @const {!HTMLIFrameElement} */
    this.iframe_ = iframe;
    /** @private @const {string} */
    this.url_ = url;
    /** @private @const {?Object} */
    this.args_ = opt_args || null;

    /** @private @const {!Window} */
    this.win_ = /** @type {!Window} */ (this.iframe_.ownerDocument.defaultView);

    /** @private @const {string} */
    this.targetOrigin_ = getOriginFromUrl(url);

    /** @private {boolean} */
    this.connected_ = false;

    /** @private {?function()} */
    this.connectedResolver_ = null;

    /** @private @const {!Promise} */
    this.connectedPromise_ = new Promise(resolve => {
      this.connectedResolver_ = resolve;
    });

    /** @private {?function()} */
    this.readyResolver_ = null;

    /** @private @const {!Promise} */
    this.readyPromise_ = new Promise(resolve => {
      this.readyResolver_ = resolve;
    });

    /** @private {?function((!ActivityResult|!Promise))} */
    this.resultResolver_ = null;

    /** @private @const {!Promise<!ActivityResult>} */
    this.resultPromise_ = new Promise(resolve => {
      this.resultResolver_ = resolve;
    });

    /** @private {?function(number)} */
    this.onResizeRequest_ = null;

    /** @private {?number} */
    this.requestedHeight_ = null;

    /** @private @const {!Messenger} */
    this.messenger_ = new Messenger(
        this.win_,
        () => this.iframe_.contentWindow,
        this.targetOrigin_);
  }

  /** @override */
  getMode() {
    return ActivityMode.IFRAME;
  }

  /**
   * Waits until the activity port is connected to the host.
   * @return {!Promise}
   */
  connect() {
    if (!this.win_.document.documentElement.contains(this.iframe_)) {
      throw new Error('iframe must be in DOM');
    }
    this.messenger_.connect(this.handleCommand_.bind(this));
    this.iframe_.src = this.url_;
    return this.connectedPromise_;
  }

  /**
   * Disconnect the activity binding and cleanup listeners.
   */
  disconnect() {
    this.connected_ = false;
    this.messenger_.disconnect();
  }

  /** @override */
  acceptResult() {
    return this.resultPromise_;
  }

  /**
   * Sends a message to the host.
   * @param {!Object} payload
   */
  message(payload) {
    this.messenger_.customMessage(payload);
  }

  /**
   * Registers a callback to receive messages from the host.
   * @param {function(!Object)} callback
   */
  onMessage(callback) {
    this.messenger_.onCustomMessage(callback);
  }

  /**
   * Creates a new communication channel or returns an existing one.
   * @param {string=} opt_name
   * @return {!Promise<!MessagePort>}
   */
  messageChannel(opt_name) {
    return this.messenger_.askChannel(opt_name);
  }

  /**
   * Returns a promise that yields when the iframe is ready to be interacted
   * with.
   * @return {!Promise}
   */
  whenReady() {
    return this.readyPromise_;
  }

  /**
   * Register a callback to handle resize requests. Once successfully resized,
   * ensure to call `resized()` method.
   * @param {function(number)} callback
   */
  onResizeRequest(callback) {
    this.onResizeRequest_ = callback;
    Promise.resolve().then(() => {
      if (this.requestedHeight_ != null) {
        callback(this.requestedHeight_);
      }
    });
  }

  /**
   * Signals back to the activity implementation that the client has updated
   * the activity's size.
   */
  resized() {
    if (!this.connected_) {
      return;
    }
    const height = this.iframe_.offsetHeight;
    this.messenger_.sendCommand('resized', {'height': height});
  }

  /**
   * @param {string} cmd
   * @param {?Object} payload
   * @private
   */
  handleCommand_(cmd, payload) {
    if (cmd == 'connect') {
      // First ever message. Indicates that the receiver is listening.
      this.connected_ = true;
      this.messenger_.sendStartCommand(this.args_);
      this.connectedResolver_();
    } else if (cmd == 'result') {
      // The last message. Indicates that the result has been received.
      if (this.resultResolver_) {
        const code = /** @type {!ActivityResultCode} */ (payload['code']);
        const data =
            code == ActivityResultCode.FAILED ?
            new Error(payload['data'] || '') :
            payload['data'];
        const result = new ActivityResult(
            code,
            data,
            ActivityMode.IFRAME,
            this.messenger_.getTargetOrigin(),
            /* originVerified */ true,
            /* secureChannel */ true);
        resolveResult(this.win_, result, this.resultResolver_);
        this.resultResolver_ = null;
        this.messenger_.sendCommand('close');
        this.disconnect();
      }
    } else if (cmd == 'ready') {
      if (this.readyResolver_) {
        this.readyResolver_();
        this.readyResolver_ = null;
      }
    } else if (cmd == 'resize') {
      this.requestedHeight_ = /** @type {number} */ (payload['height']);
      if (this.onResizeRequest_) {
        this.onResizeRequest_(this.requestedHeight_);
      }
    }
  }
}

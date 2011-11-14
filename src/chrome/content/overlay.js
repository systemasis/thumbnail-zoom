/**
 * Copyright (c) 2010 Andres Hernandez Monge
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of copyright holders nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
 * TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL COPYRIGHT HOLDERS OR CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

Cu.import("resource://thumbnailzoomplus/common.js");
Cu.import("resource://thumbnailzoomplus/pages.js");
Cu.import("resource://thumbnailzoomplus/filterService.js");
Cu.import("resource://thumbnailzoomplus/downloadService.js");
Cu.import("resource://thumbnailzoomplus/uninstallService.js");

/**
 * Controls the browser overlay.
 */
ThumbnailZoomPlusChrome.Overlay = {
  /* UI preference keys. */
  PREF_PANEL_KEY : ThumbnailZoomPlus.PrefBranch + "panel.key",
  PREF_PANEL_WAIT : ThumbnailZoomPlus.PrefBranch + "panel.wait",
  PREF_PANEL_DELAY : ThumbnailZoomPlus.PrefBranch + "panel.delay",
  PREF_PANEL_BORDER : ThumbnailZoomPlus.PrefBranch + "panel.border",
  PREF_PANEL_LARGE_IMAGE : ThumbnailZoomPlus.PrefBranch + "panel.largeimage",
  PREF_PANEL_HISTORY : ThumbnailZoomPlus.PrefBranch + "panel.history",
  PREF_PANEL_OPACITY : ThumbnailZoomPlus.PrefBranch + "panel.opacity",
  /* Toolbar button preference key. */
  PREF_TOOLBAR_INSTALLED : ThumbnailZoomPlus.PrefBranch + "button.installed",

  /* Logger for this object. */
  _logger : null,
  /* Preferences service. */
  _preferencesService : null,

  /* The timer. */
  _timer : null,
  /* The floating panel. */
  _panel : null,
  /* The floating panel image. */
  _panelImage : null,
  /* The floating panel throbber */
  _panelThrobber : null,
  /* The current image source. */
  _currentImage : null,
  /* Context download image menu item */
  _contextMenu : null,
  /* File Picker. */
  _filePicker : null,
  /* _thumbBBox is the bounding box of the thumbnail or link which caused
     the popup to launch, in screen coordinates. */
  _thumbBBox : { xMin: -999, xMax: -999, yMin: -999, yMax: 999},
  
  // _borderWidth is the spacing in pixels between the edge of the thumb and the popup.
  _borderWidth : 5, // border itself adds 5 pixels on each edge.
  
  // _widthAddon is additional image width due to border if enabled:
  // 0 or _borderWidth*2.
  _widthAddon : 0,
  _pad : 5,
  
  // _currentWindow is the window from which the current popup was launched.
  // We use this to detect when a different document has been loaded into that
  // window (as opposed to a different window).
  _currentWindow : null,
  
  
  /**
   * Initializes the object.
   */
  init : function() {
    this._logger = ThumbnailZoomPlus.getLogger("ThumbnailZoomPlusChrome.Overlay");
    this._logger.debug("init");

    this._preferencesService =
      Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch2);
    this._timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    this._panel = document.getElementById("thumbnailzoomplus-panel");
    this._panelImage = document.getElementById("thumbnailzoomplus-panel-image");
    this._panelThrobber = document.getElementById("thumbnailzoomplus-panel-throbber");
    this._contextMenu = document.getElementById("thumbnailzoomplus-context-download");

    this._filePicker =
      Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    this._filePicker.init(window, null, Ci.nsIFilePicker.modeSave);

    this._updatePreferenceFix();
    this._installToolbarButton();
    this._showPanelBorder();
    this._preferencesService.addObserver(this.PREF_PANEL_BORDER, this, false);
    this._preferencesService.addObserver(this.PREF_PANEL_OPACITY, this, false);
    this._addPreferenceObservers(true);
    this._addEventListeners();
  },


  /**
   * Uninitializes the object.
   */
  uninit : function() {
    this._logger.debug("uninit");

    this._panel = null;
    this._panelImage = null;
    this._panelThrobber = null;
    this._currentImage = null;
    this._contextMenu = null;
    this._preferencesService.removeObserver(this.PREF_PANEL_BORDER, this);
    this._preferencesService.removeObserver(this.PREF_PANEL_OPACITY, this);
    this._addPreferenceObservers(false);
  },


  /**
   * Updates preference fix.
   */
  _updatePreferenceFix : function() {
    this._logger.trace("_updatePreferenceFix");

    let delayPref = ThumbnailZoomPlus.Application.prefs.get(this.PREF_PANEL_DELAY);
    if (delayPref) {
      let preferenceService =
        Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch);
      let delayValue = String(delayPref.value);

      ThumbnailZoomPlus.Application.prefs.setValue(this.PREF_PANEL_WAIT, delayValue);
      preferenceService.clearUserPref(this.PREF_PANEL_DELAY);
    }
  },


  /**
   * Installs the toolbar button on the first run.
   */
  _installToolbarButton : function() {
    this._logger.trace("_installToolbarButton");

    let buttonInstalled =
      ThumbnailZoomPlus.Application.prefs.get(this.PREF_TOOLBAR_INSTALLED).value;

    if (!buttonInstalled) {
      let toolbarId =
        (null == document.getElementById("addon-bar") ? "nav-bar": "addon-bar");
      let toolbar = document.getElementById(toolbarId);
      let newCurrentSet = null;

      if (-1 != toolbar.currentSet.indexOf("urlbar-container")) {
         newCurrentSet = toolbar.currentSet.replace(
           /urlbar-container/, "thumbnailzoomplus-toolbar-button,urlbar-container");
      } else {
         newCurrentSet = toolbar.currentSet + ",thumbnailzoomplus-toolbar-button";
      }
      toolbar.setAttribute("currentset", newCurrentSet);
      toolbar.currentSet = newCurrentSet;
      document.persist(toolbarId, "currentset");

      try {
        BrowserToolboxCustomizeDone(true);
      } catch (e) { }

      ThumbnailZoomPlus.Application.prefs.setValue(this.PREF_TOOLBAR_INSTALLED, true);
    }
  },


  /**
   * Adds the preference observers.
   * @param aValue true if adding, false when removing.
   */
  _addPreferenceObservers : function(aValue) {
    this._logger.debug("_addPreferenceObservers");

    let pageCount = ThumbnailZoomPlus.FilterService.pageList.length;
    let preference = null;
    let pageInfo = null;

    for (let i = 0; i < pageCount; i++) {
      pageInfo = ThumbnailZoomPlus.FilterService.pageList[i];
      preference = ThumbnailZoomPlus.PrefBranch + pageInfo.key + ".enable";

      if (aValue) {
        this._preferencesService.addObserver(preference, this, false);
      } else {
        this._preferencesService.removeObserver(preference, this);
      }
    }
  },


  /**
   * Adds the menu items.
   */
  addMenuItems : function() {
    this._logger.debug("addMenuItems");

    let menuPopup = document.getElementById("thumbnailzoomplus-toolbar-menu");

    if (menuPopup) {
      let menuSeparator =
        document.getElementById("thumbnailzoomplus-toolbar-menuseparator");
      let menuItem = null;
      let pageCount = ThumbnailZoomPlus.FilterService.pageList.length;
      let pageInfo = null;

      for (let i = 0; i < pageCount; i++) {
        pageInfo = ThumbnailZoomPlus.FilterService.pageList[i];
        menuItem = document.createElement("menuitem");
        menuItem.setAttribute(
          "id", "thumbnailzoomplus-toolbar-menuitem-" + pageInfo.key);
        menuItem.setAttribute("label", pageInfo.name);
        menuItem.setAttribute("type", "checkbox");
        { 
          let aPage = i;
          menuItem.addEventListener("command",
              function() { ThumbnailZoomPlusChrome.Overlay.togglePreference(aPage);},
              true );
        }
        menuPopup.insertBefore(menuItem, menuSeparator);
        this._updatePagesMenu(i);
      }
    }
  },


  /**
   * Removes the menu items.
   */
  removeMenuItems : function() {
    this._logger.debug("removeMenuItems");

    let menuPopup = document.getElementById("thumbnailzoomplus-toolbar-menu");

    if (menuPopup) {
      let menuSeparator =
        document.getElementById("thumbnailzoomplus-toolbar-menuseparator");

      while (menuPopup.firstChild != menuSeparator) {
        menuPopup.removeChild(menuPopup.firstChild);
      }
    }
  },


  /**
   * Adds the event listeners.
   */
  _addEventListeners : function() {
    this._logger.trace("_addEventListeners");

    let that = this;

    gBrowser.addEventListener(
      "DOMContentLoaded",
      function(aEvent) { that._handlePageLoaded(aEvent); }, true);
    gBrowser.tabContainer.addEventListener(
      "TabSelect",
      function(aEvent) { that._handleTabSelected(aEvent); }, false);
    
    // These handlers are on the popup's window, not the document's:
    this._panel.addEventListener(
      "click",
      function(aEvent) {
        that._handlePopupClick(aEvent);
      }, false);
    this._panel.addEventListener(
      "mousemove",
      function(aEvent) {
        that._handlePopupMove(aEvent);
      }, true);
    
    /*
     * Add listeners in any pre-existing documents.  Normally there won't 
     * be any yet (except maybe about:none for the initial empty tab).  But
     * when a tab is dragged out to make a new window, we don't get a loaded
     * event for the doc (since it was already loaded before), but its doc
     * will already be existing when we initialize chrome for the new window. 
     */
    for (let i=0; i < gBrowser.browsers.length; i++) {
      this._logger.debug("_addEventListeners: " +
                         " pre-existing doc " + i + ": " + gBrowser.getBrowserAtIndex(i).contentDocument);
      this._addEventListenersToDoc(gBrowser.getBrowserAtIndex(i).contentDocument);
    }
  },


  /**
   * Adds listeners when the popup image is shown.  The listener is added
   * on the document itself (not the popup); otherwise we never get events,
   * perhaps due to focus issues.
   */
  _addListenersWhenPopupShown : function() {
    let that = ThumbnailZoomPlusChrome.Overlay;
    doc = content.document.documentElement;
    that._logger.debug("_addListenersWhenPopupShown for " +
      doc);
    
    // Add a keypress listener so the "Escape" key can hide the popup.
    // We don't use autohide mode since that causes Firefox to ignore
    // a mouse click done while the popup is up, and would prevent the user from
    // clicking the thumb to go to its linked page.
    doc.addEventListener(
      "keypress", that._handleKeypress, false);
      
    /*
     * Listen for pagehide events to hide the popup when navigating away
     * from the page.  Some pages like deviantart use hashtags like
     * deviantart.com/#abcde to go to different pages; we must watch for
     * that with hashchange (it doesn't get a pagehide).
     */
    window.addEventListener(
      "pagehide", that._handlePageHide, false);
    window.addEventListener(
      "hashchange", that._handleHashChange, false);
  },
  
  
  /**
   * Removes listeners when the popup image is hidden again, so we don't keep
   * a persistent key listener on the document all the time.
   */
  _removeListenersWhenPopupHidden : function() {
    let that = ThumbnailZoomPlusChrome.Overlay;
    doc = content.document.documentElement;
    that._logger.debug("_removeListenersWhenPopupHidden for " +
      doc);
    doc.removeEventListener(
      "keypress", that._handleKeypress, false);
      
    window.removeEventListener(
      "pagehide", that._handlePageHide, false);
    window.removeEventListener(
      "hashchange", that._handlePageHide, false);
  },
  
  
  /**
   * Handles the TabSelect event.
   * @param aEvent the event object.
   */
  _handleTabSelected : function(aEvent) {
    this._logger.trace("_handleTabSelected");

    /*
     * When a tab is dragged from one window to another pre-existing window,
     * we need to update its listeners to be ones in chrome of the new host
     * window.
     */
    var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                .getService(Components.interfaces.nsIWindowMediator);
    var browserWindow = wm.getMostRecentWindow("navigator:browser");
    let that = browserWindow.ThumbnailZoomPlusChrome.Overlay;
    this._logger.debug("_handleTabSelected: other win=" + that._currentWindow);
    that._addEventListenersToDoc(gBrowser.contentDocument);

    this._thumbBBox.xMax = -999; // don't reject next move as trivial.
    this._logger.debug("_closePanel since tab selected");
    this._closePanel();
  },
  
  
  /**
   * Handles the DOMContentLoaded event.
   * @param aEvent the event object.
   */
  _handlePageLoaded : function(aEvent) {
    this._logger.trace("_handlePageLoaded");
    let doc = aEvent.originalTarget;
    this._addEventListenersToDoc(doc);
  },
  
  _addEventListenersToDoc: function(doc) {
    this._logger.trace("_addEventListenersToDoc");

    this._thumbBBox.xMax = -999;

    let that = this;

    if (doc instanceof HTMLDocument) {
      this._logger.debug("_addEventListenersToDoc: *** currently, cw=" + 
                           (this._currentWindow == null ? "null" : this._currentWindow.document.documentURI) +
                           "   vs   event=" + doc.defaultView.top.document.documentURI);
      let pageConstant = ThumbnailZoomPlus.FilterService.getPageConstantByDoc(doc);

      if (-1 != pageConstant) {
        doc.addEventListener(
          "mouseover",
          function(aEvent) {
            that._handleMouseOver(doc, aEvent, pageConstant);
          }, true);
      } else {
        this._logger.debug("_addEventListenersToDoc: not on a matching site: " + doc.documentURI);
      }
    } else {
      this._logger.debug("_addEventListenersToDoc: not on an HTML doc: " + doc.documentURI);
    }
    if (this._currentWindow == doc.defaultView.top) {
      // Detected that the user loaded a different page into our window, e.g.
      // by clicking a link.  So close the popup.
      this._logger.debug("_addEventListenersToDoc: *** closing since a page loaded into its host window");
      this._closePanel();
    }
  },
  

  /**
   * Handles the mouse over event.
   * @param aEvent the event object.
   * @param aPage the filtered page.
   */
  _handleMouseOver : function(aDocument, aEvent, aPage) {
    this._logger.trace("_handleMouseOver");

    let x = aEvent.screenX;
    let y = aEvent.screenY;
    if (x >= this._thumbBBox.xMin &&
        x <= this._thumbBBox.xMax &&
        y >= this._thumbBBox.yMin &&
        y <= this._thumbBBox.yMax) {
      // Ignore attempt to redisplay the same image without first entering
      // a different element, on the assumption that it's caused by a
      // focus change after the popup was dismissed.
      return;
    }
    
    this._thumbBBox.xMax = -999;
    
    let node = aEvent.target;
    let imageSource = ThumbnailZoomPlus.FilterService.getImageSource(aDocument, node, aPage);

    if (null != imageSource && this._isKeyActive(aEvent)) {      
      if (ThumbnailZoomPlus.FilterService.isPageEnabled(aPage) &&
          ThumbnailZoomPlus.FilterService.filterImage(imageSource, aPage)) {

        this._logger.debug("_handleMouseOver: this win=" + this._currentWindow);
        this._timer.cancel();

        /*
         * Trickiness to get the right "that": normally this and 
         * ThumbnailZoomPlusChrome.Overlay automatically refer to the
         * correct instance -- which is the window the document was loaded into.
         * But if the user drags a tab into a different window, the
         * document carries its javascript state, which includes the
         * registration of mouseOver handler to this._handleMouseOver -- for
         * "this" of the original window.
         *
         * We want the popup to appear in the new window, not the original
         * one, so we explicitly find the window of the now-active browser
         * and get the ThumbnailZoomPlusChrome.Overlay object from that
         * context.
         */
/*
        var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                    .getService(Components.interfaces.nsIWindowMediator);
        var browserWindow = wm.getMostRecentWindow("navigator:browser");
        this._logger.debug("_handleMouseOver: other win=" + browserWindow.ThumbnailZoomPlusChrome.Overlay._currentWindow);
        

        let that = browserWindow.ThumbnailZoomPlusChrome.Overlay;
*/
        let that = this;
        that._currentWindow = aDocument.defaultView.top;
        that._logger.debug("_handleMouseOver: *** Setting _currentWindow=" + 
                           this._currentWindow.document.documentURI);

        that._timer.initWithCallback({ notify:
          function() { that._showZoomImage(imageSource, node, aPage, aEvent); }
        }, this._getHoverTime(), Ci.nsITimer.TYPE_ONE_SHOT);
      } else {
        this._logger.debug("_closePanel since site disabled or image URL unrecognized");
        this._closePanel();
      }
    } else {
      // This element isn't an image or the hot key isn't down.
      // This is how we dismiss the popup by moving the mouse out of
      // the thumbnail.
      this._logger.debug("_closePanel since mouse entered non-image or key not down");
      this._closePanel();
    }
  },


  /**
   * Verifies if the key is active.
   * @param aEvent the event object.
   * @return true if active, false otherwise.
   */
  _isKeyActive : function(aEvent) {
    this._logger.trace("_isKeyActive");

    let active = false;
    let keyPref = ThumbnailZoomPlus.Application.prefs.get(this.PREF_PANEL_KEY);

    switch (keyPref.value) {
      case 1:
        active = aEvent.ctrlKey;
        break;
      case 2:
        active = aEvent.shiftKey;
        break;
      case 3:
        active = aEvent.altKey;
        break;
      default:
        active = true;
        break;
    }

    return active;
  },


  /**
   * Gets the hover time.
   * @return the hover time, 0 by default.
   */
  _getHoverTime : function() {
    this._logger.trace("_getHoverTime");

    let hoverTime = 0;
    let delayPref = ThumbnailZoomPlus.Application.prefs.get(this.PREF_PANEL_WAIT);

    if (delayPref && !isNaN(delayPref.value)) {
      hoverTime = 1000 * delayPref.value;
    }

    return hoverTime;
  },


  /**
   * Shows the zoom image panel.
   * @param aImageSrc the image source
   * @param aImageNode the image node
   * @param aPage the page constant
   */
  _showZoomImage : function(aImageSrc, aImageNode, aPage, aEvent) {
    this._logger.trace("_showZoomImage");

    let zoomImageSrc = ThumbnailZoomPlus.FilterService.getZoomImage(aImageSrc, aPage);

    if (null != zoomImageSrc) {
      this._showPanel(aImageNode, zoomImageSrc, aEvent);
    } else {
      this._logger.debug("_closePanel since not a recognized image URL");
      this._closePanel();
    }
  },


  /**
   * Shows the panel.
   * @param aImageNode the image node.
   * @param aImageSrc the image source.
   */
  _showPanel : function(aImageNode, aImageSrc, aEvent) {
    this._logger.trace("_showPanel");

    // reset previous pic.
    this._panelImage.style.maxWidth = "";
    this._panelImage.style.minWidth = "";
    this._panelImage.style.maxHeight = "";
    this._panelImage.style.minHeight = "";
    this._logger.debug("_closePanel since closing any prev popup before loading new one");
    this._closePanel();

    // open new pic.
    if (this._panel.state != "open") {
      let throbberDelay = 0.3 * 1000;
      if (throbberDelay > 0.0) {
        let that = this;
        this._logger.debug("_showPanel: start timer which pops up throbber.");
        this._timer.initWithCallback({ notify: function() { that._showThrobber(aImageNode)}, }, 
                                  throbberDelay, Ci.nsITimer.TYPE_ONE_SHOT);
      } else {
        this._showThrobber();
      }
    }
    this._currentImage = aImageSrc;
    this._contextMenu.hidden = false;
    this._preloadImage(aImageNode, aImageSrc, aEvent);
  },

  _showThrobber : function(aImageNode) {
    this._logger.trace("_showThrobber");
    // Pop up the panel, causing the throbber to display near
    // the image thumbnail.
    // this._panelThrobber.hidden = false;
    this._panel.openPopup(aImageNode, "end_before", this._pad, this._pad, false, false);
    this._addListenersWhenPopupShown();
  },
  
  /**
   * Closes the panel.
   */
  _closePanel : function() {
    try {
      // When called from _handlePageHide after closing window with Control+W
      // while popup is up, some of the statements below raise exceptions
      // e.g. there is no this._contextMenu.  I suspect it's because the
      // chrome is already being destroyed when this is called.  So we
      // silently ignore exceptions here.
      this._logger.trace("_closePanel");

      this._currentImage = null;
      this._contextMenu.hidden = true;
      this._panelThrobber.hidden = false;
      this._timer.cancel();
      this._removeListenersWhenPopupHidden();
      if (this._panel.state != "closed") {
        this._panel.hidePopup();
      }
      // We no longer need the image contents so help the garbage collector:
      this._panelImage.removeAttribute("src");
    } catch (e) {
      this._logger.debug("_closePanel: exception: " + e);
    }
  },


  /**
   * Event handler for mouse movement over the popup,
   * which can happen when the popup overlaps the thumbnail.
   * This routine closes the dialog if the mouse is outside
   * the bounds of the thumbnail.
   */
  _handlePopupMove : function(aEvent) {
    let x = aEvent.screenX;
    let y = aEvent.screenY;

    if (x >= this._thumbBBox.xMin &&
        x <= this._thumbBBox.xMax &&
        y >= this._thumbBBox.yMin &&
        y <= this._thumbBBox.yMax) {
      // Mouse is still over the thumbnail.  Ignore the move and don't
      // dismiss since the thumb would immediately receive an 'over' event
      // and retrigger the popup to display.
      this._logger.debug("_handlePopupMove: ignoring since mouse at " +
                         x + "," + y +
                         " is within thumb " +
                         this._thumbBBox.xMin + ".." + this._thumbBBox.xMax + "," +
                         this._thumbBBox.yMin + ".." + this._thumbBBox.yMax);
      return;
    }
    // moved outside bbox of thumb; dismiss popup.
    this._logger.debug("_handlePopupMove: closing with mouse at " +
                        aEvent.screenX + "," + aEvent.screenY);
    this._closePanel();
  },


  _handlePopupClick : function(aEvent) {
    this._logger.debug("_handlePopupClick: mouse at " +
                        aEvent.screenX + "," + aEvent.screenY);
    this._closePanel();
  },
  
  
  _handleKeypress : function(aEvent) {
    let that = ThumbnailZoomPlusChrome.Overlay;
    that._logger.debug("_handleKeypress for "  +
       aEvent.keyCode );
    if (aEvent.keyCode == 27 /* Escape key */) {
      that._logger.debug("_closePanel since pressed Esc key");
      that._closePanel();
    }
  },
  
  
  _handlePageHide : function(aEvent) {
    let that = ThumbnailZoomPlusChrome.Overlay;
    that._logger.debug("_handlePageHide: *** currently, cw=" + 
                        (that._currentWindow == null ? "null" : that._currentWindow.document.documentURI) +
                        "   vs   event=" + aEvent.originalTarget.defaultView.top.document.documentURI);
    if (that._currentWindow == aEvent.originalTarget.defaultView.top) {
      that._logger.debug("_handlePageHide: closing panel");
      that._closePanel();
    }
    return true; // allow page to hide
  },
  
  
  _handleHashChange : function(aEvent) {
    let that = ThumbnailZoomPlusChrome.Overlay;
    that._logger.debug("_handleHashChange: closing panel");
    that._closePanel();
  },
  
    
  /**
   * Preloads the image.
   * @param aImageNode the image node.
   * @param aImageSrc the image source.
   * @param aEvent the mouse event which caused us to preload the image.
   */
  _preloadImage : function(aImageNode, aImageSrc, aEvent) {
    this._logger.trace("_preloadImage");

    let that = this;
    let image = new Image();
    // TODO: it'd be better to save the image object in the ThumbnailZoomPlus
    // object so we can delete it when we load another image (so it doesn't
    // keep loading in the background).
    image.onload = function() {
      if (that._currentImage == aImageSrc) {
        // This is the image URL we're currently loading (not another previously
        // image we had started loading).
        
        // Close and (probably) re-open the panel so we can reposition it to
        // display the image.  Note that if the image is too large to
        // fit to the left/right of the thumb, we pop-up relative to the upper-left
        // corner of the browser instead of relative to aImageSrc.
        // This allows us to display larger pop-ups. 
        that._logger.debug("hidePopup in image onload");
        that._panel.hidePopup();

        let pageZoom = gBrowser.selectedBrowser.markupDocumentViewer.fullZoom;
        
        clientToScreenX = aEvent.screenX - aEvent.clientX * pageZoom;
        clientToScreenY = aEvent.screenY - aEvent.clientY * pageZoom;
        that._updateThumbBBox(aImageNode, 
                              clientToScreenX, clientToScreenY);
        let available = that._getAvailableSizeOutsideThumb(aImageNode);
        
        // Get the popup image's display size, which is the largest we
        // can display the image (without magnifying it and without it
        // being too big to fit on-screen).
        let imageSize = that._getScaleDimensions(image, available);

        that._logger.debug("_preloadImage: available w/l/r:" + available.width + 
                           "/" + available.left + 
                           "/" + available.right +
                           "; h/t/b:" + available.height + 
                           "/" + available.top + 
                           "/" + available.bottom);
        that._logger.debug("_preloadImage: " + 
                           "win width=" + content.window.innerWidth*pageZoom +
                           "; win height=" + content.window.innerHeight*pageZoom +
                           "; full-size image=["+image.width + "," + image.height + 
                           "]; max imageSize which fits=["+imageSize.width + "," + imageSize.height +"]"); 
        
        let thumbWidth = aImageNode.offsetWidth * pageZoom;
        let thumbHeight = aImageNode.offsetHeight * pageZoom;
        if (imageSize.width < thumbWidth * 1.20 &&
            imageSize.height < thumbHeight * 1.20) {
          that._logger.debug("_preloadImage: skipping: popup image size (" +
              imageSize.width + " x " + imageSize.height + 
              ") isn't at least 20% bigger than thumb (" +
              thumbWidth + " x " + thumbHeight + ")");
          that._removeListenersWhenPopupHidden();

          return;
        }
      
        that._openAndPositionPopup(aImageNode, aImageSrc, imageSize, available);
        
        // Help the garbage collector reclaim memory quickly.
        // (Test by watching "images" size in about:memory.)
        image.src = null;
        delete image;
        image = null;

      }
    };
    image.onerror = function(aEvent) {
      that._logger.debug("In image onerror");
      if (that._currentImage == aImageSrc) {
        that._logger.debug("_closePanel since error loading image (" + aEvent + ")");
        that._closePanel();
      }
    };

    image.src = aImageSrc;
  },


  /**
   * Opens the popup positioned appropriately relative to the thumbnail
   * aImageNode.
   */
  _openAndPositionPopup : function(aImageNode, aImageSrc, imageSize, available) {
    // We prefer above/below thumb to avoid tooltip.
    if (imageSize.height <= available.height) {
      // Position the popup horizontally flush with the right of the window or
      // left-aligned with the left of the thumbnail, whichever is left-most.
      let pageZoom = gBrowser.selectedBrowser.markupDocumentViewer.fullZoom;
      let windowStartX = content.window.mozInnerScreenX * pageZoom;
      let pageWidth = content.window.innerWidth * pageZoom;
      let popupXPageCoords = pageWidth - (imageSize.width + this._widthAddon);
      let popupXScreenCoords = popupXPageCoords + windowStartX;
      let popupXOffset = popupXScreenCoords - this._thumbBBox.xMin;
      this._logger.debug("_openAndPositionPopup: " +
                         "windowStartX=" + windowStartX +
                         "; pageWidth=" + pageWidth +
                         "; popupXPageCoords=" + popupXPageCoords +
                         "; popupXScreenCoords=" + popupXScreenCoords +
                         "; popupXOffset=" + popupXOffset);
      if (popupXOffset > 0) {
        popupXOffset = 0;
      }
      if (imageSize.height <= available.bottom) {
        this._logger.debug("_openAndPositionPopup: display below thumb"); 
        this._panel.openPopup(aImageNode, "after_start", popupXOffset, this._pad, false, false);
      } else {
        this._logger.debug("_openAndPositionPopup: display above thumb"); 
        this._panel.openPopup(aImageNode, "before_start", popupXOffset, -this._pad, false, false);
      }
    } else if (imageSize.width <= available.width) {
      // We prefer left-of thumb over right-of thumb since tooltip
      // typically extends to the right.
      
      // Position the popup vertically flush with the bottom of the window or
      // top-aligned with the top of the thumbnail, whichever is higher.
      // We don't simply use a 0 offset and rely on Firefox's logic since
      // on Windows that can position the thumb under an always-on-top
      // Windows task bar.
      let pageZoom = gBrowser.selectedBrowser.markupDocumentViewer.fullZoom;
      let windowStartY = content.window.mozInnerScreenY * pageZoom;
      let pageHeight = content.window.innerHeight * pageZoom;
      let popupYPageCoords = pageHeight - (imageSize.height + this._widthAddon);
      let popupYScreenCoords = popupYPageCoords + windowStartY;
      let popupYOffset = popupYScreenCoords - this._thumbBBox.yMin;
      this._logger.debug("_openAndPositionPopup: " +
                         "windowStartY=" + windowStartY +
                         "; pageHeight=" + pageHeight +
                         "; popupYPageCoords=" + popupYPageCoords +
                         "; popupYScreenCoords=" + popupYScreenCoords +
                         "; popupYOffset=" + popupYOffset);
      if (popupYOffset > 0) {
        popupYOffset = 0;
      }
      if (imageSize.width <= available.left) {
        this._logger.debug("_openAndPositionPopup: display to left of thumb"); 
        this._panel.openPopup(aImageNode, "start_before", -this._pad, popupYOffset, false, false);
      } else {
        this._logger.debug("_openAndPositionPopup: display to right of thumb"); 
        this._panel.openPopup(aImageNode, "end_before", this._pad, popupYOffset, false, false);
      }
    } else {
      this._logger.debug("_openAndPositionPopup: display in upper-left of window (overlap thumb)"); 
      this._panel.openPopup(null, "overlap", 0, 0, false, false);
    }
    
    this._addListenersWhenPopupShown();
    this._showImage(aImageSrc, imageSize);
  },
  
  
  /**
   * Updates this._thumbBBox to indicate the range of DOM coordinates spanned
   * by the thumb or link.
   */
  _updateThumbBBox : function(aImageNode, xOffset, yOffset) {
    this._logger.trace("_updateThumbBBox");
    			
    var viewportElement = document.documentElement;  
    var scrollLeft = viewportElement.scrollLeft;
    var scrollTop = viewportElement.scrollTop;
    let pageZoom = gBrowser.selectedBrowser.markupDocumentViewer.fullZoom;
    var box = aImageNode.getBoundingClientRect();

    this._logger.debug("_updateThumbBBox: scroll = " +
                       scrollLeft + "," + scrollTop);
    this._logger.debug("_updateThumbBBox: doc to screen offset = " +
                       xOffset + "," + yOffset);

    this._thumbBBox.xMin = xOffset + box.left * pageZoom + scrollLeft;
		this._thumbBBox.yMin = yOffset + box.top  * pageZoom + scrollTop;
    
    this._thumbBBox.xMax = this._thumbBBox.xMin + aImageNode.offsetWidth * pageZoom;
    this._thumbBBox.yMax = this._thumbBBox.yMin + aImageNode.offsetHeight * pageZoom;
    
    this._logger.debug("_updateThumbBBox: bbox = " +
                       this._thumbBBox.xMin + ".." + this._thumbBBox.xMax + "," +
                       this._thumbBBox.yMin + ".." + this._thumbBBox.yMax);
  },  
  
  
  /**
   * Returns the width of the larger of the space to the left or
   * right of the thumbnail, and the height of the larger of the space
   * above and below it.  This is the space into which the
   * image would have to fit if we displayed it to the side of or
   * above/below the thumbnail without overlapping it.
   *
   * @param aImageNode the image node.
   * @return An object with .left, .right, .top, .bottom, .width and .height 
   * fields.
   */
  _getAvailableSizeOutsideThumb : function(aImageNode) {
    this._logger.trace("_getAvailableSizeOutsideThumb");
    let pageZoom = gBrowser.selectedBrowser.markupDocumentViewer.fullZoom;
    
    /*
     * pageLeft is the space available to the left of the thumb. 
     * pageTop is the space available above it.
     */
    let available = {};

    available.left = this._thumbBBox.xMin - content.window.mozInnerScreenX * pageZoom;
    available.top = this._thumbBBox.yMin - content.window.mozInnerScreenY * pageZoom;
    
    /*
     * pageRight is the space available to the right of the thumbnail,
     * and pageBottom the space below.
     */
    let pageWidth = content.window.innerWidth * pageZoom;
    let pageHeight = content.window.innerHeight * pageZoom;

    available.right = pageWidth - available.left - aImageNode.offsetWidth * pageZoom;
    available.bottom = pageHeight - available.top - aImageNode.offsetHeight * pageZoom;

    adjustment = 2*this._pad + this._widthAddon;
    this._logger.debug("_getAvailableSizeOutsideThumb: " +
                       "available.left,right before adjustment = " + 
                       available.left + "," + available.top +
                       "; _pad=" + this._pad + 
                       "; _widthAddon=" + this._widthAddon +
                       "; reducing available by " + adjustment);
    available.left -= adjustment;
    available.right -= adjustment;
    available.top -= adjustment;
    available.bottom -= adjustment;
    
    available.width = Math.max(available.left, available.right);
    available.height = Math.max(available.top, available.bottom);

    return available;
  },


  /**
   * Gets the image scale dimensions to fit the window.
   * @param aImage the image info.
   * @param available: contains (width, height) of the max space available
   * to the left or right and top or bottom of the thumb.
   * @return the scale dimensions.
   */
  _getScaleDimensions : function(aImage, available) {
    this._logger.trace("_getScaleDimensions");

    // When enabled, we allow showing images larger 
    // than would fit entirely to the left or right of
    // the thumbnail by using the full page width
    let pageZoom = gBrowser.selectedBrowser.markupDocumentViewer.fullZoom;
    let pageWidth = content.window.innerWidth * pageZoom - this._widthAddon - 2;
    let pageHeight = content.window.innerHeight * pageZoom - this._widthAddon - 2;
    
    let imageWidth = aImage.width;
    let imageHeight = aImage.height;
    let scaleRatio = (imageWidth / imageHeight);
    let scale = { width: imageWidth, height: imageHeight };

    // Make sure scale.width, height is not larger than the window size.
    if (scale.height > pageHeight) {
      scale.height = pageHeight;
      scale.width = Math.round(scale.height * scaleRatio);
    }
    if (scale.width > pageWidth) {
      scale.width = pageWidth;
      scale.height = Math.round(scale.width / scaleRatio);
    }

    // Calc sideScale as the biggest size we can use for the image without
    // overlapping the thumb.
    let sideScale = {width: scale.width, height: scale.height};
    if (imageHeight > available.height) {
      // Try fitting the image's height to available.height (and scaling
      // width proportionally); this corresponds to showing the
      // popup above or below the thumb.
      sideScale.height = available.height;
      sideScale.width = Math.round(sideScale.height * scaleRatio);
    }
    if (sideScale.width < available.width) {
      // We can show the image larger by fitting its width to available.width
      // rather than fitting its height; this allows it to appear to
      // the left or right of the thumb.
      sideScale.width = Math.min(available.width, imageWidth);
      sideScale.height = Math.round(sideScale.width / scaleRatio);
    }
    if (sideScale.height > pageHeight) {
      sideScale.height = pageHeight;
      sideScale.width = Math.round(scale.height * scaleRatio);
    }
    if (sideScale.width > pageWidth) {
      sideScale.width = pageWidth;
      sideScale.height = Math.round(sideScale.width / scaleRatio);
    }

    let allowCoverThumb = ThumbnailZoomPlus.Application.prefs.get(this.PREF_PANEL_LARGE_IMAGE);
    allowCoverThumb = allowCoverThumb && allowCoverThumb.value;

    // Check whether to allow popup to cover thumb.
    if (! allowCoverThumb) {
      this._logger.debug("_getScaleDimensions: disallowing covering thumb because of pref");
      scale = sideScale;
    } else if (scale.width < (sideScale.width * 1.20)) {
      this._logger.debug("_getScaleDimensions: disallowing covering " + 
                         "thumb because covering width " + scale.width +
                         " isn't at least 20% bigger than uncovered width " +
                         sideScale.width);
      scale = sideScale;
    }

    return scale;
  },


  /**
   * Shows the image in the panel.
   * @param aImageSrc the image source.
   * @param aScale the scale dimmensions.
   */
  _showImage : function(aImageSrc, aScale) {
    this._logger.trace("_showImage");

    if (aScale) {
      this._panelImage.style.maxWidth = aScale.width + "px";
      this._panelImage.style.minWidth = aScale.width + "px";
      this._panelImage.style.maxHeight = aScale.height + "px";
      this._panelImage.style.minHeight = aScale.height + "px";
    }
    this._panelImage.src = aImageSrc;
    this._panelThrobber.hidden = true;
    
    this._addToHistory(aImageSrc);
  },


  /**
   * Opens the preferences window.
   */
  openPreferences : function() {
    this._logger.debug("openPreferences");

    let optionsDialog =
      window.openDialog("chrome://thumbnailzoomplus/content/options.xul",
        "thumbnailzoomplus-options-window", "chrome,centerscreen");

    optionsDialog.focus();
  },


  /**
   * Downloads the full image.
   */
  downloadImage : function() {
    this._logger.debug("downloadImage");

    if (null != this._currentImage) {
      let fileURL = this._currentImage;
      let filePickerResult = null;
      let filePickerName =
        fileURL.substring(fileURL.lastIndexOf('/') + 1, fileURL.length);

      this._filePicker.defaultString = filePickerName;
      filePickerResult = this._filePicker.show();

      if (Ci.nsIFilePicker.returnOK == filePickerResult ||
          Ci.nsIFilePicker.returnReplace == filePickerResult) {
        let filePath = this._filePicker.file.path;
        let image = new Image();

        image.onload = function() {
          ThumbnailZoomPlus.DownloadService.downloadImage(
            image, filePath, window);
        };
        image.src = fileURL;
      }
    }
  },


  /**
   * Toggles the preference value.
   * @param aPage the page constant.
   */
  togglePreference : function(aPage) {
    this._logger.debug("togglePreference");

    ThumbnailZoomPlus.FilterService.togglePageEnable(aPage);
  },


  /**
   * Updates the pages menu.
   * @param aPage the page constant.
   */
  _updatePagesMenu : function(aPage) {
    this._logger.trace("_updatePagesMenu");

    let pageName = ThumbnailZoomPlus.FilterService.getPageName(aPage);
    let pageEnable = ThumbnailZoomPlus.FilterService.isPageEnabled(aPage);
    let menuItemId = "thumbnailzoomplus-toolbar-menuitem-" + pageName;
    let menuItem = document.getElementById(menuItemId);

    if (null != menuItem) {
      menuItem.setAttribute("checked", pageEnable);
    }
  },


  /**
   * Shows the panel border based in the preference value.
   */
  _showPanelBorder : function() {
    this._logger.trace("_showPanelBorder");

    let panelBorder = ThumbnailZoomPlus.Application.prefs.get(this.PREF_PANEL_BORDER);

    if (panelBorder && panelBorder.value) {
      this._panel.removeAttribute("panelnoborder");
      this._widthAddon = this._borderWidth * 2;
    } else {
      this._panel.setAttribute("panelnoborder", true);
      this._widthAddon = 0;
    }
  },


  /**
   * Updates the panel opacity based in the preference value.
   */
  _updatePanelOpacity : function() {
    this._logger.trace("_updatePanelOpacity");

    let panelOpacity = ThumbnailZoomPlus.Application.prefs.get(this.PREF_PANEL_OPACITY);

    if (panelOpacity && panelOpacity.value) {
      this._panel.style.opacity = panelOpacity.value / 100;
    }
  },


  /**
   * Observes the authentication topic.
   * @param aSubject The object related to the change.
   * @param aTopic The topic being observed.
   * @param aData The data related to the change.
   */
  observe : function(aSubject, aTopic, aData) {
    this._logger.debug("observe");

    if ("nsPref:changed" == aTopic &&
        -1 != aData.indexOf(ThumbnailZoomPlus.PrefBranch)) {
      if (-1 != aData.indexOf(".enable")) {
        let page =
          aData.replace(ThumbnailZoomPlus.PrefBranch, "").replace(".enable", "");
        let pageConstant = ThumbnailZoomPlus.FilterService.getPageConstantByName(page);

        if (-1 != pageConstant) {
          this._updatePagesMenu(pageConstant);
        }
      } else {
        switch (aData) {
          case this.PREF_PANEL_BORDER:
            this._showPanelBorder();
            break;
          case this.PREF_PANEL_OPACITY:
            this._updatePanelOpacity();
            break;
        }
      }
    }
  },
  
  
  _addToHistory : function(url) {
    let allowRecordingHistory = ThumbnailZoomPlus.Application.prefs.get(this.PREF_PANEL_HISTORY);
    if (! allowRecordingHistory || !allowRecordingHistory.value) {
    this._logger.debug("_addToHistory: history pref is off.");  
      return;
    }
    
    // We don't need to check for Private Browsing mode; addURI is automatically
    // ignored in that mode.
    if (url.indexOf(" ") != -1   
        || url.split("?")[0].indexOf("..") != -1) {  
      this._logger.debug("_addToHistory: bad URL syntax");  
      return;  
    }  
    
    this._logger.debug("_addToHistory: '" + url + "'");  
    let ioService = Components.classes["@mozilla.org/network/io-service;1"]  
                          .getService(Components.interfaces.nsIIOService);
    let nsIURI = ioService.newURI(url, null, null);
    
    let historyService2 = Components.classes["@mozilla.org/browser/nav-history-service;1"]
                          .getService(Components.interfaces.nsIGlobalHistory2);  
    
    historyService2.addURI(nsIURI, false, true, null);  
    
  }

};

window.addEventListener(
  "load", function() { ThumbnailZoomPlusChrome.Overlay.init(); }, false);
window.addEventListener(
  "unload", function() { ThumbnailZoomPlusChrome.Overlay.uninit(); }, false);

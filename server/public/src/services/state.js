registerModule('services/state', (require, exports) => {
  let selectedRover = null;

  function setSelected(roverId) {
    selectedRover = roverId;
  }

  function getSelected() {
    return selectedRover;
  }

  exports.setSelected = setSelected;
  exports.getSelected = getSelected;
});
